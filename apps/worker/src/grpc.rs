use std::{error::Error, io, time::Duration};

use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint, Identity};

use crate::wire::worker_control_service_client::WorkerControlServiceClient;
use crate::{HandshakeError, MAX_HELLO_BYTES, accept_home_frame, valid_id, wire, worker_hello};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);

pub struct WorkerEnrollment<'a> {
    pub home_id: &'a str,
    pub worker_id: &'a str,
    pub home_ca_pem: &'a [u8],
    pub worker_certificate_pem: &'a [u8],
    pub worker_private_key_pem: &'a [u8],
    /// The name the home's certificate carries, checked whatever address it is reached at: a home that is its own
    /// authority names itself so. None checks the address's own host name.
    pub server_name: Option<&'a str>,
}

pub(crate) fn endpoint(
    address: &str,
    enrollment: &WorkerEnrollment<'_>,
) -> Result<Endpoint, Box<dyn Error + Send + Sync>> {
    if !valid_id(enrollment.home_id, "home_") {
        return Err(HandshakeError::InvalidIdentity.into());
    }
    let endpoint = Endpoint::from_shared(address.to_owned())?;
    if endpoint.uri().scheme_str() != Some("https") || enrollment.home_ca_pem.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "A trusted HTTPS home is required",
        )
        .into());
    }
    let mut tls = ClientTlsConfig::new()
        .ca_certificate(Certificate::from_pem(enrollment.home_ca_pem))
        .identity(Identity::from_pem(
            enrollment.worker_certificate_pem,
            enrollment.worker_private_key_pem,
        ));
    if let Some(name) = enrollment.server_name {
        tls = tls.domain_name(name);
    }
    Ok(endpoint.tls_config(tls)?)
}

pub(crate) fn control_client(channel: Channel) -> WorkerControlServiceClient<Channel> {
    WorkerControlServiceClient::new(channel)
        .max_decoding_message_size(MAX_HELLO_BYTES)
        .max_encoding_message_size(MAX_HELLO_BYTES)
}

/// Confirm one enrolled TLS peer and negotiated protocol session.
pub async fn probe_home(
    address: &str,
    enrollment: WorkerEnrollment<'_>,
) -> Result<wire::HomeHello, Box<dyn Error + Send + Sync>> {
    let offer = worker_hello(enrollment.worker_id)?;
    tokio::time::timeout(HANDSHAKE_TIMEOUT, async {
        let mut client = control_client(endpoint(address, &enrollment)?.connect().await?);
        let mut reply = client
            .connect(tokio_stream::once(offer))
            .await?
            .into_inner();
        let frame = reply.message().await?.ok_or(HandshakeError::InvalidFrame)?;
        let hello = accept_home_frame(frame, enrollment.home_id, enrollment.worker_id)?;
        if reply.message().await?.is_some() {
            return Err(HandshakeError::InvalidFrame.into());
        }
        Ok(hello)
    })
    .await?
}

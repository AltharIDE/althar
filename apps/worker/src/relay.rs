use std::{error::Error, io, sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use hyper_util::rt::TokioIo;
use rustls::{
    ClientConfig, RootCertStore,
    pki_types::{CertificateDer, pem::PemObject},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio_tungstenite::{
    Connector, connect_async_tls_with_config,
    tungstenite::{
        Message,
        client::IntoClientRequest,
        http::{HeaderValue, Uri, header::AUTHORIZATION},
        protocol::WebSocketConfig,
    },
};
use tonic::transport::{Channel, Endpoint};
use tower::service_fn;

use crate::valid_id;

const WS_FRAME_LIMIT: usize = 256 * 1024;
const BUFFER_BYTES: usize = 64 * 1024;
const CHUNK_BYTES: usize = 16 * 1024;
const READY: &[u8] = &[1];
type Failure = Box<dyn Error + Send + Sync>;

pub struct WorkerRelay<'a> {
    pub url: &'a str,
    pub token: &'a str,
    pub ca_pem: &'a [u8],
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn relay_identity(relay: &WorkerRelay<'_>) -> Result<(Uri, HeaderValue), Failure> {
    let uri: Uri = relay.url.parse()?;
    let mut path = uri.path().split('/');
    let version = (path.next(), path.next(), path.next());
    let route = path.next().filter(|route| valid_id(route, "wrl_"));
    if uri.scheme_str() != Some("wss")
        || uri
            .authority()
            .is_none_or(|value| value.as_str().contains('@'))
        || uri.query().is_some()
        || relay.url.contains('#')
        || version != (Some(""), Some("v1"), Some("worker-relay"))
        || route.is_none()
        || path.next() != Some("worker")
        || path.next().is_some()
        || relay.token.len() != 43
        || !relay
            .token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid("A valid WSS worker relay URL and credential are required").into());
    }
    let mut authorization = HeaderValue::from_str(&format!("Bearer {}", relay.token))?;
    authorization.set_sensitive(true);
    Ok((uri, authorization))
}

pub(crate) async fn relay_channel(
    endpoint: Endpoint,
    relay: &WorkerRelay<'_>,
) -> Result<Channel, Failure> {
    let (uri, authorization) = relay_identity(relay)?;
    let mut trust = RootCertStore::empty();
    for certificate in CertificateDer::pem_slice_iter(relay.ca_pem) {
        trust.add(certificate?)?;
    }
    if trust.is_empty() {
        return Err(invalid("The relay requires a trusted CA certificate").into());
    }
    let tls = Arc::new(
        ClientConfig::builder()
            .with_root_certificates(trust)
            .with_no_client_auth(),
    );
    Ok(endpoint
        .connect_with_connector(service_fn(move |_| {
            let uri = uri.clone();
            let authorization = authorization.clone();
            let tls = tls.clone();
            async move {
                let stream = tokio::time::timeout(
                    Duration::from_secs(12),
                    open_tunnel(uri, authorization, tls),
                )
                .await??;
                Ok::<_, Failure>(TokioIo::new(stream))
            }
        }))
        .await?)
}

async fn open_tunnel(
    uri: Uri,
    authorization: HeaderValue,
    tls: Arc<ClientConfig>,
) -> Result<DuplexStream, Failure> {
    let mut request = uri.into_client_request()?;
    request.headers_mut().insert(AUTHORIZATION, authorization);
    let config = WebSocketConfig::default()
        .max_message_size(Some(WS_FRAME_LIMIT))
        .max_frame_size(Some(WS_FRAME_LIMIT))
        .max_write_buffer_size(WS_FRAME_LIMIT);
    let (mut socket, _) =
        connect_async_tls_with_config(request, Some(config), false, Some(Connector::Rustls(tls)))
            .await
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::ConnectionRefused,
                    "Could not authenticate the worker relay",
                )
            })?;
    loop {
        match socket.next().await {
            Some(Ok(Message::Binary(marker))) if marker.as_ref() == READY => break,
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
            _ => return Err(invalid("The worker relay did not pair the connection").into()),
        }
    }

    let (application, relay) = tokio::io::duplex(BUFFER_BYTES);
    tokio::spawn(async move {
        let (mut outgoing, mut incoming) = socket.split();
        let (mut reader, mut writer) = tokio::io::split(relay);
        let send = async {
            let mut bytes = [0; CHUNK_BYTES];
            loop {
                let count = reader.read(&mut bytes).await?;
                if count == 0 {
                    return Ok::<(), Failure>(());
                }
                outgoing
                    .send(Message::Binary(bytes[..count].to_vec().into()))
                    .await?;
            }
        };
        let receive = async {
            while let Some(message) = incoming.next().await {
                match message? {
                    Message::Binary(bytes) => writer.write_all(&bytes).await?,
                    Message::Ping(_) | Message::Pong(_) => {}
                    _ => return Err(invalid("Invalid worker relay frame").into()),
                }
            }
            Ok::<(), Failure>(())
        };
        tokio::select! {
            _ = send => {},
            _ = receive => {},
        }
    });
    Ok(application)
}

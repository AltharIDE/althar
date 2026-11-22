#![forbid(unsafe_code)]

use prost::Message;
use std::{error::Error, fmt};

#[cfg(target_os = "linux")]
pub mod agent;
#[cfg(target_os = "linux")]
mod agent_managed;
#[cfg(target_os = "linux")]
mod agent_preview;
#[cfg(target_os = "linux")]
mod agent_setup;
#[cfg(target_os = "linux")]
mod agent_tools;
#[cfg(target_os = "linux")]
mod agent_workspace;
#[cfg(target_os = "linux")]
pub mod diagnostic;
pub mod grpc;
#[cfg(target_os = "linux")]
pub mod project;
#[cfg(target_os = "linux")]
pub mod relay;

pub mod wire {
    include!(concat!(env!("OUT_DIR"), "/althar.worker.v1.rs"));
}

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_HELLO_BYTES: usize = 4096;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandshakeError {
    InvalidIdentity,
    OversizedFrame,
    InvalidFrame,
    IncompatibleVersion,
    WrongPeer,
}

impl fmt::Display for HandshakeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidIdentity => "Invalid worker or home identity",
            Self::OversizedFrame => "Worker handshake frame is too large",
            Self::InvalidFrame => "Invalid worker handshake frame",
            Self::IncompatibleVersion => "The home selected an unsupported worker protocol version",
            Self::WrongPeer => "The home returned a different worker or home identity",
        };
        f.write_str(message)
    }
}

impl Error for HandshakeError {}

fn valid_id(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|suffix| {
        suffix.len() == 32
            && suffix
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    })
}

/// Build the first frame after transport authentication.
pub fn worker_hello(worker_id: &str) -> Result<wire::WorkerFrame, HandshakeError> {
    if !valid_id(worker_id, "wrk_") {
        return Err(HandshakeError::InvalidIdentity);
    }
    Ok(wire::WorkerFrame {
        payload: Some(wire::worker_frame::Payload::Hello(wire::WorkerHello {
            worker_id: worker_id.to_owned(),
            min_version: PROTOCOL_VERSION,
            max_version: PROTOCOL_VERSION,
            accepts_diagnostics: false,
            renews_diagnostic_lease: false,
            streams_diagnostic_logs: false,
            accepts_project_commands: false,
        })),
    })
}

/// Accept a negotiated session only for the home and worker bound at enrollment.
pub fn accept_home_hello(
    bytes: &[u8],
    home_id: &str,
    worker_id: &str,
) -> Result<wire::HomeHello, HandshakeError> {
    if !valid_id(home_id, "home_") || !valid_id(worker_id, "wrk_") {
        return Err(HandshakeError::InvalidIdentity);
    }
    if bytes.len() > MAX_HELLO_BYTES {
        return Err(HandshakeError::OversizedFrame);
    }
    let frame = wire::HomeFrame::decode(bytes).map_err(|_| HandshakeError::InvalidFrame)?;
    accept_home_frame(frame, home_id, worker_id)
}

fn accept_home_frame(
    frame: wire::HomeFrame,
    home_id: &str,
    worker_id: &str,
) -> Result<wire::HomeHello, HandshakeError> {
    let Some(wire::home_frame::Payload::Hello(hello)) = frame.payload else {
        return Err(HandshakeError::InvalidFrame);
    };
    if hello.version != PROTOCOL_VERSION {
        return Err(HandshakeError::IncompatibleVersion);
    }
    if hello.home_id != home_id || hello.worker_id != worker_id {
        return Err(HandshakeError::WrongPeer);
    }
    if !valid_id(&hello.session_id, "wsn_") {
        return Err(HandshakeError::InvalidFrame);
    }
    Ok(hello)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "home_0123456789abcdef0123456789abcdef";
    const WORKER: &str = "wrk_0123456789abcdef0123456789abcdef";
    const SESSION: &str = "wsn_0123456789abcdef0123456789abcdef";

    fn response(hello: wire::HomeHello) -> Vec<u8> {
        wire::HomeFrame {
            payload: Some(wire::home_frame::Payload::Hello(hello)),
        }
        .encode_to_vec()
    }

    fn hello() -> wire::HomeHello {
        wire::HomeHello {
            home_id: HOME.to_owned(),
            worker_id: WORKER.to_owned(),
            session_id: SESSION.to_owned(),
            version: PROTOCOL_VERSION,
            supports_diagnostics: false,
            supports_diagnostic_lease_renewal: false,
            supports_diagnostic_logs: false,
            supports_project_commands: false,
        }
    }

    #[test]
    fn confirms_the_current_version_for_the_enrolled_worker_and_home() {
        let bytes = response(hello());
        assert_eq!(accept_home_hello(&bytes, HOME, WORKER), Ok(hello()));
        assert_eq!(
            worker_hello(&format!("{WORKER}\n")),
            Err(HandshakeError::InvalidIdentity)
        );
    }

    #[test]
    fn rejects_unconfirmed_peer_identity_or_version() {
        let wrong_home = "home_ffffffffffffffffffffffffffffffff";
        let wrong_worker = "wrk_ffffffffffffffffffffffffffffffff";
        let bytes = response(hello());
        assert_eq!(
            accept_home_hello(&bytes, wrong_home, WORKER),
            Err(HandshakeError::WrongPeer)
        );
        assert_eq!(
            accept_home_hello(&bytes, HOME, wrong_worker),
            Err(HandshakeError::WrongPeer)
        );
        for version in [0, PROTOCOL_VERSION + 1] {
            let bytes = response(wire::HomeHello { version, ..hello() });
            assert_eq!(
                accept_home_hello(&bytes, HOME, WORKER),
                Err(HandshakeError::IncompatibleVersion)
            );
        }
    }

    #[test]
    fn rejects_invalid_or_over_budget_messages() {
        for bytes in [
            vec![],
            vec![0xff],
            response(wire::HomeHello {
                session_id: String::new(),
                ..hello()
            }),
        ] {
            assert_eq!(
                accept_home_hello(&bytes, HOME, WORKER),
                Err(HandshakeError::InvalidFrame)
            );
        }
        assert_eq!(
            accept_home_hello(&vec![0; MAX_HELLO_BYTES + 1], HOME, WORKER),
            Err(HandshakeError::OversizedFrame)
        );
    }
}

use std::io;

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    task::JoinSet,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Channel;

use crate::{
    grpc::control_client,
    wire::{AgentToolsRequest, agent_tools_request::Payload},
};

const LIMIT: usize = 4;
const CHUNK: usize = 2048;

async fn forward(
    channel: Channel,
    run_id: String,
    connection: TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (send, receive) = mpsc::channel(4);
    send.send(AgentToolsRequest {
        payload: Some(Payload::RunId(run_id)),
    })
    .await?;
    let (mut local_input, mut local_output) = connection.into_split();
    let upload = async move {
        let mut chunk = [0; CHUNK];
        loop {
            let count = local_input.read(&mut chunk).await?;
            if count == 0 {
                return Ok::<(), io::Error>(());
            }
            send.send(AgentToolsRequest {
                payload: Some(Payload::Data(chunk[..count].to_vec())),
            })
            .await
            .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
        }
    };
    let download = async {
        let mut peer = control_client(channel)
            .agent_tools(ReceiverStream::new(receive))
            .await?
            .into_inner();
        while let Some(frame) = peer.message().await? {
            if frame.data.is_empty() || frame.data.len() > CHUNK {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid agent tool response",
                )
                .into());
            }
            local_output.write_all(&frame.data).await?;
        }
        local_output.shutdown().await?;
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    };
    tokio::pin!(upload, download);
    tokio::select! {
        read = &mut download => read,
        write = &mut upload => {
            write?;
            download.await
        }
    }
}

pub(crate) async fn forward_tools(
    listener: TcpListener,
    channel: Channel,
    run_id: &str,
) -> io::Result<()> {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            connection = listener.accept(), if connections.len() < LIMIT => {
                let (connection, _) = connection?;
                let channel = channel.clone();
                let run_id = run_id.to_owned();
                connections.spawn(async move {
                    // Local MCP clients will see the connection close if the home withdrew the grant.
                    let _ = forward(channel, run_id, connection).await;
                });
            }
            _ = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

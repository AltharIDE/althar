use std::{env, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("../../packages/worker-protocol/proto");
    let schema = root.join("althar/worker/v1/control.proto");
    println!("cargo:rerun-if-changed={}", schema.display());
    let mut config = prost_build::Config::new();
    config.protoc_executable(protoc_bin_vendored::protoc_bin_path()?);
    tonic_prost_build::configure()
        .build_server(false)
        // The RPC is named Connect. The caller builds its own TLS channel.
        .build_transport(false)
        .compile_with_config(config, &[schema], &[root])?;
    Ok(())
}

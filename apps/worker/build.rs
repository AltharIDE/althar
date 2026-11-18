use std::{env, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("../../packages/worker-protocol/proto");
    let schema = root.join("althar/worker/v1/control.proto");
    println!("cargo:rerun-if-changed={}", schema.display());
    prost_build::Config::new()
        .protoc_executable(protoc_bin_vendored::protoc_bin_path()?)
        .compile_protos(&[schema], &[root])?;
    Ok(())
}

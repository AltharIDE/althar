use std::{fs, path::Path};

use crate::wire::{
    AgentWorkerAgentStart, AgentWorkerModel, AgentWorkerModels, AgentWorkerReadiness,
    AgentWorkerTool,
};

/*
 * What the worker's own check found (`althar-host worker check`, run as its setup ends, after each sign-in, each time
 * its service starts, with its hourly timer and at the window's Check again), kept beside `signed-in` as lines of
 * tab-separated fields:
 *
 *   sandbox  starts
 *   sandbox  fails   <code>
 *   fix      <the command an administrator runs to let it start>
 *   tool     <name>  <version>
 *   model    <provider>  <id>  <name>
 *   agent    <provider>  starts
 *   agent    <provider>  fails   <why, in its own words>
 *
 * Read again at each hello and every fourth heartbeat, as `signed-in` is, so the home hears within seconds what changed.
 */

const READINESS_BYTES: u64 = 256 * 1024;
const TOOLS: usize = 64;
const MODELS: usize = 96;
const FIELD: usize = 200;
const FIX: usize = 4096;

fn field(value: &str, limit: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= limit && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

/// The check the file keeps, for the agents of `providers`; none where there is no file to read.
pub(crate) fn readiness_from(path: &Path, providers: &[String]) -> Option<AgentWorkerReadiness> {
    if fs::metadata(path).ok()?.len() > READINESS_BYTES {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let mut readiness = AgentWorkerReadiness::default();
    let mut checked = false;
    for line in text.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        match fields.as_slice() {
            ["sandbox", "starts"] => {
                checked = true;
                readiness.sandbox_starts = true;
                readiness.sandbox_problem.clear();
            }
            ["sandbox", "fails", code] => {
                checked = true;
                readiness.sandbox_starts = false;
                readiness.sandbox_problem = field(code, 48).unwrap_or_else(|| "Failed".into());
            }
            ["fix", command] => {
                if let Some(command) = field(command, FIX) {
                    readiness.sandbox_fix = command;
                }
            }
            ["tool", name, version] if readiness.tools.len() < TOOLS => {
                if let (Some(name), Some(version)) = (field(name, 48), field(version, 64))
                    && !readiness.tools.iter().any(|tool| tool.name == name)
                {
                    readiness.tools.push(AgentWorkerTool { name, version });
                }
            }
            ["agent", provider, "starts"] if providers.iter().any(|known| known == provider) => {
                started(&mut readiness, provider, true, String::new());
            }
            ["agent", provider, "fails", problem]
                if providers.iter().any(|known| known == provider) =>
            {
                let problem = field(problem, FIELD * 2).unwrap_or_default();
                started(&mut readiness, provider, false, problem);
            }
            ["model", provider, id, name] if providers.iter().any(|known| known == provider) => {
                let (Some(id), Some(name)) = (field(id, FIELD), field(name, FIELD)) else {
                    continue;
                };
                let at = match readiness
                    .models
                    .iter()
                    .position(|models| models.provider_id == *provider)
                {
                    Some(at) => at,
                    None => {
                        readiness.models.push(AgentWorkerModels {
                            provider_id: (*provider).to_owned(),
                            models: Vec::new(),
                        });
                        readiness.models.len() - 1
                    }
                };
                let models = &mut readiness.models[at].models;
                if models.len() < MODELS && !models.iter().any(|model| model.id == id) {
                    models.push(AgentWorkerModel { id, name });
                }
            }
            _ => {}
        }
    }
    checked.then_some(readiness)
}

/// Whether an agent started once as a run starts it, kept once for each agent: the last line for it stands.
fn started(readiness: &mut AgentWorkerReadiness, provider: &str, starts: bool, problem: String) {
    readiness
        .agents
        .retain(|agent| agent.provider_id != provider);
    readiness.agents.push(AgentWorkerAgentStart {
        provider_id: provider.to_owned(),
        starts,
        problem,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_says_its_sandbox_tools_and_models_and_nothing_it_cannot_vouch_for()
    -> std::io::Result<()> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("readiness");
        assert!(readiness_from(&path, &["claude-code".into()]).is_none());
        fs::write(
            &path,
            "sandbox\tfails\tNoUserNamespaces\nfix\tsudo sh -c 'apparmor_parser -r x'\ntool\tbun\t1.3.5\ntool\tbun\t1.0.0\n\
             tool\tgit\t2.43.0\nmodel\tclaude-code\topus\tClaude Opus 5.5\nmodel\tclaude-code\topus\tAgain\n\
             model\tunknown\tm\tM\nmodel\tclaude-code\tbad\x07\tBell\nnonsense line\n\
             agent\tclaude-code\tfails\tSandbox required but unavailable\nagent\tunknown\tstarts\n",
        )?;
        let read = readiness_from(&path, &["claude-code".into()]).expect("a check");
        assert!(!read.sandbox_starts);
        assert_eq!(read.sandbox_problem, "NoUserNamespaces");
        assert_eq!(read.sandbox_fix, "sudo sh -c 'apparmor_parser -r x'");
        assert_eq!(
            read.tools
                .iter()
                .map(|tool| (tool.name.as_str(), tool.version.as_str()))
                .collect::<Vec<_>>(),
            vec![("bun", "1.3.5"), ("git", "2.43.0")]
        );
        assert_eq!(read.models.len(), 1);
        assert_eq!(read.models[0].models.len(), 1);
        assert_eq!(read.models[0].models[0].name, "Claude Opus 5.5");
        assert_eq!(read.agents.len(), 1, "only the agents it has");
        assert!(!read.agents[0].starts);
        assert_eq!(read.agents[0].problem, "Sandbox required but unavailable");
        fs::write(&path, "tool\tbun\t1.3.5\n")?;
        assert!(
            readiness_from(&path, &[]).is_none(),
            "no sandbox line: not checked"
        );
        fs::write(&path, "sandbox\tstarts\n")?;
        assert!(readiness_from(&path, &[]).expect("a check").sandbox_starts);
        Ok(())
    }
}

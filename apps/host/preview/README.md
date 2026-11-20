# Try an Althar home and worker

Start with one Linux machine. The **home** keeps the project and remembers each run. The **worker** runs a command in a checkout. The demo puts both on the same machine so you can see the whole loop before setting up a server of your own.

The download includes the host, its Node runtime, the worker and the demo. Bring an ordinary Linux login, Git, OpenSSL, `unzip`, and enough space for a 400 MB download and roughly 1.1 GB once extracted. Ubuntu 24.04 works. Other distributions need systemd 254 or later, a running systemd user session and cgroup v2.

## Try the complete loop on one machine

1. **Check the Linux machine.** Run these in its terminal. If you're using a VPS, SSH in as the regular user who will run the demo.

   ```sh
   uname -m
   systemd --version | head -n 1
   systemctl --user show-environment >/dev/null && echo "User service manager is ready"
   stat -f -c %T /sys/fs/cgroup
   git --version
   openssl version
   command -v unzip
   ```

   Look for systemd 254 or later, `User service manager is ready` and `cgroup2fs`. If the user service manager check fails, try a fresh SSH login as your regular user. A Linux VM with a working user service manager is a good place to run the demo.

2. **Download the right ZIP.** Sign in to GitHub and choose the download that matches the **Linux machine's** `uname -m` result.

   | Result | Download |
   | --- | --- |
   | `x86_64` | [Linux x64 ZIP](https://github.com/AltharIDE/althar/actions/runs/44645972692/artifacts/14588986131) |
   | `aarch64` | [Linux arm64 ZIP](https://github.com/AltharIDE/althar/actions/runs/44645972692/artifacts/14588641807) |

   Put the ZIP in your home directory on the Linux machine. If it downloaded to your laptop, run the matching command there, substituting your SSH login for `user@server`.

   ```sh
   scp "$HOME/Downloads/althar-preview-linux-x64.zip" user@server:~/
   # For arm64, use this line instead.
   scp "$HOME/Downloads/althar-preview-linux-arm64.zip" user@server:~/
   ```

   GitHub keeps these downloads for 30 days. If they have expired, look for a newer successful run with a **Linux preview** job for your architecture. A maintainer can start a fresh build with **Run workflow** on `main`. [Worker workflow](https://github.com/AltharIDE/althar/actions/workflows/worker.yml)

3. **Unpack and check the download.** Back in the Linux terminal, set `arch=x64` for `x86_64` or `arch=arm64` for `aarch64`. If your browser renamed the ZIP, use the name it saved.

   ```sh
   arch=x64
   trial=$(mktemp -d "$HOME/althar-preview.XXXXXX")
   unzip "$HOME/althar-preview-linux-$arch.zip" -d "$trial"
   cd "$trial"
   sha256sum -c "althar-preview-linux-$arch.sha256"
   ```

   If the checksum line ends in `OK`, extract the tarball in the same terminal. If it fails, download a fresh ZIP first.

   ```sh
   tar -xzf "althar-preview-linux-$arch.tar.gz"
   cd althar-preview
   ```

4. **Run the demo.**

   ```sh
   ./demo
   ```

   The demo creates a temporary Git project and certificates, starts the home and enrolls the worker. It runs a Git check, restarts the home and waits for the worker to reconnect. Next it cancels a run that started a detached child process and checks that the child stopped.

5. **Look for the pass message.** Each run will have its own ID. The output should include these lines.

   ```text
   Home ready home_…
   Run wpr_… succeeded
   true
   Project check completed
   The restarted home kept its identity and the completed run.
   Run wpr_… cancelled and its detached child stopped
   Host and worker preview passed.
   ```

   The demo stops the processes it started and removes its temporary project and credentials. If it fails, keep the output from the first error through the end. Fix the failed prerequisite, then run `./demo` again to start with fresh data.

## Connect the desktop to a test home over SSH

Try this next if you want to see a real home in Althar. Give the test home its own profile and service so you can stop it independently. Keep the unpacked bundle at the same path while the service is installed.

1. **On the Linux machine**, stay in the unpacked `althar-preview` directory. Create the test project, start a home for it and check its status.

   ```sh
   home_test=$(mktemp -d "$HOME/althar-ssh-test.XXXXXX")
   home_service="althar-test-${home_test##*.}"
   git init "$home_test/hello-host"
   ./althar-host init --profile "$home_test/profile" --key-file "$home_test/master-key" \
     --project "$home_test/hello-host" --json
   ./althar-host install-service --profile "$home_test/profile" --key-file "$home_test/master-key" \
     --service-name "$home_service" --start
   ./althar-host status --profile "$home_test/profile" --wait --json
   printf 'Profile %s\nLauncher %s/althar-host\n' "$home_test/profile" "$(pwd -P)"
   ```

   Save the `homeId` from the `ready` status and the two absolute paths printed below it.

2. **On your desktop machine**, confirm that ordinary SSH works from a terminal. On the first login, check the host key fingerprint before accepting it. Back in your desktop terminal, run this to check that SSH can connect without prompts.

   ```sh
   ssh -o BatchMode=yes -o StrictHostKeyChecking=yes user@server true
   ```

3. **In Althar**, open **Homes → Connect a home… → SSH**. Enter the same `user@server` or SSH alias. Under **Connection options**, paste the server's paths into **Home’s profile on the host** and **althar-host on the host**. Use the absolute paths printed in step 1.

4. Choose **Check host**. Compare the displayed identity with the `homeId` from step 1. Give the home a name and choose **Connect**. You should see the `hello-host` project. Close that home window and open it again from **Homes**. The same project should still be there.

5. **On the Linux machine**, disable and stop the test service when you're done. This leaves the test files available if you want to inspect them.

   ```sh
   systemctl --user disable --now "$home_service.service"
   ```

## Run your own project

Use the bundled `./althar-host` and `./althar-worker` for these steps.

1. Initialize the home with `./althar-host init --json --project /absolute/path/to/repository`. Save the home and project IDs it prints, then start the home with `./althar-host install-service --start`. For an existing home, use its current profile and project IDs.
2. Give the home and worker their own certificates, configure the worker listener, enroll the worker certificate and restart the home. Queue the short Linux diagnostic first so you know the connection works. [Configure and test a worker connection](https://github.com/AltharIDE/althar/blob/main/apps/host/README.md#native-worker-diagnostic)
3. Put a checkout on the worker. Give the worker a private configuration file that maps the home project ID and a name, such as `check`, to a command in that checkout. Start the worker with `--project-config` and `--watch` so it can pick up runs as they arrive. [Set up a project command](https://github.com/AltharIDE/althar/blob/main/apps/host/README.md#run-a-project-command-on-a-linux-worker)
4. On the home, queue `check` with `worker-project-run`. Save the attempt ID and use `worker-log` and `worker-result` to see the output and outcome. Use `worker-cancel` to stop a run while it's active. Pick a command that fits the one-minute preview budget.

The same steps work with the worker on another Linux machine. Use a private connection such as Tailscale and a home certificate that covers the name the worker connects to. Keep the worker's private key and journal with its OS account.

cask "althar" do
  version "0.5.0"
  sha256 "5f73e969595b6855db95ed97abf5664d3e31028daca8258813d19ba4803f5637"

  url "https://github.com/AltharIDE/althar/releases/download/v#{version}/Althar-#{version}-arm64.dmg"
  name "Althar"
  desc "Desktop app for running a software project with AI coding agents"
  homepage "https://althar.ai/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :ventura

  app "Althar.app"

  zap trash: [
    "~/Library/Application Support/@althar",
    "~/Library/Application Support/Althar",
    "~/Library/Caches/althar-updater",
    "~/Library/Caches/dev.althar.app",
    "~/Library/HTTPStorages/dev.althar.app",
    "~/Library/Logs/Althar",
    "~/Library/Preferences/dev.althar.app.plist",
  ]
end

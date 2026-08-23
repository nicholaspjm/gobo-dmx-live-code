# Homebrew formula for the gobo connector.
#
# A browser cannot open a UDP socket, so Art-Net, sACN and OSC need this small
# native program running beside the page. Nothing gobo ships is signed, and a
# browser marks what it downloads as quarantined, which is why Gatekeeper
# refuses the macOS connector and why allowing it under Privacy and Security is
# often not enough on Apple Silicon. Homebrew removes that attribute from what
# it installs, so the same unsigned binary runs: no certificate, no
# notarisation, no security dialog.
#
# The tap is this repository. There is no second repo to keep in step:
#
#   brew tap nicholaspjm/gobo https://github.com/nicholaspjm/gobo-dmx-live-code
#   brew install gobo-connector
#
# The five lines ending in a "# gobo:" marker are rewritten by
# .github/workflows/release.yml when a tag is pushed. That is how the version
# and the checksums stay true without anyone having to remember them, and it is
# why those lines look machine-written.
#
# The version is declared rather than left for brew to read out of the URL. The
# file names carry an architecture with digits in it, arm64 and x86_64, and a
# version guessed off the wrong part of the name would be wrong quietly.
#
# A checksum reading PENDING_FIRST_RELEASE means what it says: no release has
# published that archive yet, so there is no hash that could be correct. It is
# a word rather than a hash on purpose. A wrong sha256 fails on a stranger's
# machine after a long download, while a word fails at once and names what is
# missing.
class GoboConnector < Formula
  desc "Local bridge from the gobo browser app to Art-Net, sACN and OSC"
  homepage "https://github.com/nicholaspjm/gobo-dmx-live-code"
  version "0.3.0" # gobo:version
  license "MIT"

  livecheck do
    url "https://github.com/nicholaspjm/gobo-dmx-live-code/releases/latest"
    strategy :github_latest
  end

  on_macos do
    # Apple Silicon only, said out loud. The connector is a copy of the node
    # binary with the app injected into it, so it runs on the architecture it
    # was built on, and release.yml builds the macOS one on macos-latest, which
    # is arm64. Declaring that here fails with a sentence instead of "bad CPU
    # type in executable" the first time someone runs it.
    depends_on arch: :arm64

    url "https://github.com/nicholaspjm/gobo-dmx-live-code/releases/download/v0.3.0/gobo-connector-macos-arm64.tar.gz" # gobo:url macos-arm64
    sha256 "PENDING_FIRST_RELEASE" # gobo:sha256 macos-arm64
  end

  on_linux do
    # Same reasoning: the Linux connector is built on ubuntu-latest, x86_64.
    depends_on arch: :x86_64

    url "https://github.com/nicholaspjm/gobo-dmx-live-code/releases/download/v0.3.0/gobo-connector-linux-x86_64.tar.gz" # gobo:url linux-x86_64
    sha256 "PENDING_FIRST_RELEASE" # gobo:sha256 linux-x86_64
  end

  def install
    # One file, already executable. The release ships the bare binaries too,
    # but a browser download of one loses the execute bit, while a tar entry
    # carries its own mode. That is the whole reason the formula takes an
    # archive.
    bin.install "gobo-connector"
  end

  # Homebrew's own way of running something at login. The connector can install
  # a LaunchAgent itself, and under Homebrew it deliberately does not: it would
  # record the versioned Cellar path it is running from, which the next
  # `brew upgrade` moves out from under it, leaving a login item pointing at a
  # connector that is gone or stale. A stale connector is the exact failure this
  # project has already spent two investigations on.
  #
  # `brew services start gobo-connector` instead. Homebrew writes the agent
  # against the stable opt path and rewrites it on upgrade.
  service do
    run [opt_bin/"gobo-connector", "--no-install", "--no-open"]
    keep_alive true
    log_path var/"log/gobo-connector.log"
    error_log_path var/"log/gobo-connector.log"
  end

  def caveats
    <<~EOS
      Start it, then open the app and press ctrl+enter:

        gobo-connector
        https://nicholaspjm.github.io/gobo-dmx-live-code/

      The first run registers a per-user login item, so it is already running
      next time you log in. It records the path of the copy that ran, and brew
      keeps each version in its own directory, so after an upgrade run this
      once to repoint it:

        gobo-connector --uninstall && gobo-connector

      Scene code picks the output with artnet(), sacn() or osc(), so there is
      no file to edit. To fix a startup mode instead, pass one:

        gobo-connector --config ~/.config/gobo/bridge.config.json
    EOS
  end

  test do
    (testpath/"bridge.config.json").write '{ "mode": "mock" }'
    log = testpath/"connector.log"

    # --no-install is load-bearing. A packaged connector registers a login item
    # the first time it runs, and a test has no business writing into anyone's
    # LaunchAgents; --no-open keeps it from opening a browser on the way past.
    # mock mode keeps the test off the network: it only logs.
    connector = bin/"gobo-connector"
    pid = spawn(connector.to_s,
                "--config", "#{testpath}/bridge.config.json",
                "--no-install", "--no-open",
                [:out, :err] => log.to_s)
    begin
      sleep 5
      output = log.read

      # Read this process's own log, not only the HTTP reply. The port is fixed
      # at 3001, so a connector the user already had running would answer for
      # us and a reply-only test would pass without proving anything about what
      # was just installed.
      assert_match "config loaded, mode: mock", output
      assert_match "WebSocket server on ws://localhost:3001", output
      assert_match "gobo bridge running", shell_output("curl -s --max-time 5 http://localhost:3001/")
    ensure
      Process.kill "TERM", pid
      Process.wait pid
    end
  end
end

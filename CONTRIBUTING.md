# Contribution guidelines

Contributing to this project should be as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features

## Github is used for everything

Github is used to host code, to track issues and feature requests, as well as accept pull requests.

Pull requests are the best way to propose changes to the codebase.

1. Fork the repo and create your branch from `main`.
2. If you've changed something, update the documentation.
3. Make sure your code follows the project style (see [Use a Consistent Coding Style](#use-a-consistent-coding-style) below).
4. Test you contribution.
5. Issue that pull request!

## Any contributions you make will be under the MIT Software License

In short, when you submit code changes, your submissions are understood to be under the same [MIT License](http://choosealicense.com/licenses/mit/) that covers the project. Feel free to contact the maintainers if that's a concern.

## Report bugs using Github's [issues](../../issues)

GitHub issues are used to track public bugs. Please use the [bug report template](../../issues/new/choose) — it'll walk you through everything we need to help you quickly.

## Use a Consistent Coding Style

[black](https://github.com/ambv/black) is handy to make sure the code follows the style.

## Blueprint & References

There's no single blueprint that covers everything this integration does, so we stood on the shoulders of a few community giants and fused them together.

**[ludeeus/integration_blueprint](https://github.com/ludeeus/integration_blueprint)** — the community standard starting point for HACS integration structure, manifest, and repo layout.

**[hacs/integration](https://github.com/hacs/integration)** — the real-world reference for registering a custom sidebar panel, using `helpers.storage` for persistence, and exposing a WebSocket API. Big codebase, but the patterns are gold.

**[How to Add a Sidebar Panel to a Home Assistant Integration](https://community.home-assistant.io/t/how-to-add-a-sidebar-panel-to-a-home-assistant-integration/981585)** — a concise community walkthrough (Jan 2026) that fills gaps the official docs leave open, covering `register_panel`, WebSocket backend communication, and manifest dependencies.

We took the repo structure from the first, the architectural patterns from the second, and the practical wiring guide from the third. If you're building something similar, hopefully this project now serves as a fourth reference that ties it all together in one readable place.

## License

By contributing, you agree that your contributions will be licensed under its MIT License.

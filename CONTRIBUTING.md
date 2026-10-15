# Contributing to 3D Bench

Report bugs and propose features in the [3D Bench issue tracker](https://github.com/kcfresh53/3Dbench/issues). Include reproduction steps, your operating system, app version, and a small example project when possible.

Run `npm ci --include=optional`, `npm run build-electron`, and the relevant tests before opening a pull request. Humanoid geometry checks run with `npm run test:humanoid`. Edit translations in `lang/`; preserve translation keys for compatibility.

Contributions must comply with [GPL-3.0](LICENSE.MD) and the [Code of Conduct](CODE_OF_CONDUCT.MD). Retain upstream attribution. 3D Bench is a fork of [Blockbench](https://github.com/JannisX11/blockbench), created by Jannis Petersen and contributors.

The upstream plugin API and project format remain available for compatibility. Report fork-specific behavior here, rather than to the upstream maintainers.

# vibetree

A modern desktop application built with [Tauri v2](https://v2.tauri.app/), [React](https://react.dev/), and [Vite](https://vite.dev/).

## Prerequisites

Before you begin, ensure you have the following installed on your machine:

- **Node.js**: [LTS version recommended](https://nodejs.org/).
- **pnpm**: Fast, disk space efficient package manager. Install with `npm install -g pnpm`.
- **Rust**: The Rust toolchain is required for Tauri. Install via [rustup](https://rustup.rs/).
- **OS-specific dependencies**: Tauri requires native system libraries.

### Linux (Ubuntu/Debian) dependencies

Install these packages before running `pnpm tauri dev`:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  curl \
  wget \
  file \
  pkg-config \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libxdo-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

If you use a different Linux distro, see the official [Tauri Prerequisites guide](https://v2.tauri.app/start/prerequisites/).

## Getting Started

Follow these steps to set up the project locally:

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd vibetree
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

## Development

To run the application in development mode with hot-reloading:

```bash
pnpm tauri dev
```

This command will start the Vite frontend and the Tauri Rust backend simultaneously.

## Troubleshooting (Linux)

### `webkit2gtk-4.1` / `javascriptcoregtk-4.1` / `libsoup-3.0` not found

If `pnpm tauri dev` fails with errors like:

- `The system library webkit2gtk-4.1 required by crate webkit2gtk-sys was not found`
- `The system library javascriptcoregtk-4.1 required by crate javascriptcore-rs-sys was not found`
- `The system library libsoup-3.0 required by crate soup3-sys was not found`

install the Ubuntu dependencies listed above, then verify:

```bash
pkg-config --modversion webkit2gtk-4.1
pkg-config --modversion javascriptcoregtk-4.1
pkg-config --modversion libsoup-3.0
```

All three commands should print a version number.

`PKG_CONFIG_PATH` is normally not needed when packages are installed from apt. If you installed libraries manually, set `PKG_CONFIG_PATH` to the directory that contains the corresponding `.pc` files.

### Setup notes (Ubuntu 24.04)

- Running `pnpm tauri dev` failed until the Linux WebKit/JavaScriptCore/libsoup development packages were installed.
- The initial error message referenced `webkit2gtk-4.1.pc` and an unset `PKG_CONFIG_PATH`, but the root issue was missing system packages.

## Testing

To run the frontend unit tests using [Vitest](https://vitest.dev/):

```bash
pnpm test
```

## Building for Production

To create a production-ready bundle for your current platform:

```bash
pnpm tauri build
```

The output will be located in `src-tauri/target/release/bundle`.

## Project Structure

- `src/`: React frontend source code.
- `src-tauri/`: Rust backend and Tauri configuration.
- `public/`: Static assets for the frontend.
- `dist/`: Compiled frontend assets (generated after build).

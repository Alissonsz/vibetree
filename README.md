# vibetree

A modern desktop application built with [Tauri v2](https://v2.tauri.app/), [React](https://react.dev/), and [Vite](https://vite.dev/).

## Prerequisites

Before you begin, ensure you have the following installed on your machine:

- **Node.js**: [LTS version recommended](https://nodejs.org/).
- **pnpm**: Fast, disk space efficient package manager. Install with `npm install -g pnpm`.
- **Rust**: The Rust toolchain is required for Tauri. Install via [rustup](https://rustup.rs/).
- **OS Specific Dependencies**: Tauri requires some system dependencies. Check the [Tauri Prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your operating system (Windows, macOS, or Linux).

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

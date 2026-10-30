# Versions

Exact versions in use. Stable releases only, each at least two weeks old when adopted. `npm run
check:conventions` fails if a row here disagrees with `package-lock.json`, `src-tauri/Cargo.lock` or
`rust-toolchain.toml`.

## Toolchain

| Tool             | Version                   | Pinned by                |
| ---------------- | ------------------------- | ------------------------ |
| Node.js          | 24.3.0 (24.x required)    | `package.json` `engines` |
| npm              | 11.11.0                   | — (ships with Node)      |
| Rust             | 1.97.1                    | `rust-toolchain.toml`    |
| WebView2 Runtime | 156.0.4314.50 at adoption | the OS; evergreen        |

## npm packages

| Package            | Version |
| ------------------ | ------- |
| next               | 16.4.2  |
| react              | 19.3.1  |
| react-dom          | 19.3.1  |
| three              | 0.186.1 |
| @react-three/fiber | 9.8.2   |
| @react-three/drei  | 10.7.9  |
| pdfjs-dist         | 6.4.299 |
| @tauri-apps/api    | 2.12.4  |
| @tauri-apps/cli    | 2.12.3  |
| typescript         | 6.0.3   |
| eslint             | 9.39.5  |
| eslint-config-next | 16.4.2  |
| prettier           | 3.9.10  |
| vitest             | 4.1.12  |
| @types/node        | 24.19.2 |
| @types/react       | 19.3.0  |
| @types/react-dom   | 19.3.0  |
| @types/three       | 0.186.0 |

## Rust crates

| Crate               | Version |
| ------------------- | ------- |
| tauri               | 2.12.4  |
| tauri-build         | 2.7.3   |
| tauri-plugin-dialog | 2.8.3   |
| lopdf               | 0.45.0  |
| serde               | 1.0.229 |
| serde_json          | 1.0.154 |

## Choices that are not simply "latest"

- **TypeScript 6.0.3, not 7.0.** 7.0 is the native (Go) compiler; Next's build type-check uses the
  TypeScript JavaScript API. Revisit when Next documents TypeScript 7 support.
- **eslint 9.39.5, not 10.** `eslint-config-next` 16.4.2 depends on `eslint-plugin-react`, `jsx-a11y` and
  `import`, whose peer ranges stop at eslint 9. eslint 10 ran, but outside those declared ranges. npm marks
  9.x as past support; it is a development-only tool. Revisit when those plugins accept eslint 10.
- **Next 16.4.2, Tauri CLI 2.12.3, tauri 2.12.4, tauri-build 2.7.3:** the newest releases at least two weeks
  old on 2026-10-30; the newer patches were days old.

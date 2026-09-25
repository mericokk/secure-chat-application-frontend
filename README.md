# Secure Chat Application (Frontend)

## Project Overview

This project is the **frontend** of a **Secure Chat Application** built with **React, TypeScript, and Vite**. It implements **end-to-end encryption (E2EE)** for group messaging using the browser-native **Web Crypto API**, so that the backend never has access to plaintext messages or group encryption keys — only ciphertext and per-member wrapped key packets ever leave the client. The service communicates with a **GraphQL** backend (queries, mutations, and subscriptions) and is designed around a strict client-side crypto boundary: private keys are generated and used exclusively in the browser and are never transmitted.

## Features

- **End-to-End Encryption (E2EE)**: Messages are encrypted locally with **AES-256-GCM**; the server only ever stores and relays ciphertext.
- **Hybrid Key Model**: Each group is protected by a single symmetric **AES-GCM group key**. That key is individually wrapped for every member using a shared secret derived via **ECDH (P-256)** between the distributor's private key and each member's public key, so the server can never unwrap it itself.
- **Group Key Versioning & Rotation**: Every group tracks an incrementing `keyVersion`. Adding/removing a member, or an explicit manual rotation, opens a new version and redistributes the group key only to the group's **current** members, preserving forward secrecy while keeping historical access for messages a member actually witnessed.
- **Real-Time Messaging**: New messages and membership changes are pushed live via GraphQL **subscriptions** over `graphql-ws`.
- **Session Management**: Stateless JWT authentication; the access token is kept in `sessionStorage` and attached to every GraphQL request as an `Authorization: Bearer` header.
- **Modern UI**: Responsive, dark-themed interface built with **Tailwind CSS v4**.

## Project Structure

The project follows a flat, responsibility-oriented layout under `src/`, separating UI, transport, and cryptography into distinct modules.

| File | Role and Responsibility |
| :--- | :--- |
| **`App.tsx`** | **Application Layer:** Auth flow, group/message screens, and top-level state management. |
| **`chatService.ts`** | **Transport Layer:** Apollo Client setup and every GraphQL query, mutation, and subscription used by the app. |
| **`cryptoService.ts`** | **Cryptographic Primitives:** Low-level Web Crypto API operations — ECDH key generation/import/export, AES-GCM encrypt/decrypt, base64 helpers. |
| **`cryptoHandler.ts`** | **Crypto Orchestrator:** Group key generation, per-member key wrapping/distribution, rotation, and decryption workflows built on top of `cryptoService.ts`. |
| **`types.ts`** | **Domain Modeling:** TypeScript interfaces mirroring the backend GraphQL schema (inputs, entities, responses). |
| **`index.css`** | Global styles and Tailwind v4 entry point. |
| **`main.jsx`** | Application bootstrap / root render. |

## Encryption Flow (Summary)

1. On registration, the client generates an **ECDH P-256** key pair. Only the public key is sent to the server; the private key never leaves the browser.
2. When a group is created (or its membership changes), a random **AES-GCM group key** is generated client-side.
3. That group key is wrapped separately for **each current member**: a shared secret is derived from the distributor's private key and the recipient's public key, and used to encrypt the group key. The resulting `{ encryptedGroupKey, iv, senderPublicKey }` packet is saved server-side, scoped to that one recipient.
4. Messages are encrypted with the active group key before being sent, tagged with the `keyVersion` used.
5. Recipients derive the same shared secret from the packet's `senderPublicKey` and their own private key to unwrap the group key, then decrypt the message.
6. When a member leaves or is removed, `keyVersion` advances and the new key is distributed only to remaining members — a returning member keeps access to versions they previously held, but not to versions issued during their absence.

## GraphQL Operations

| Category | Operation | Type | Description |
| :--- | :--- | :--- | :--- |
| **Auth** | `login` | Mutation | Authenticates a user and returns a JWT access token. |
| **Auth** | `registerUser` | Mutation | Registers a new user with their generated public key. |
| **Auth** | `updatePublicKey` | Mutation | Rotates a user's identity key pair. |
| **Groups** | `createGroup` | Mutation | Creates a new group and its initial key. |
| **Groups** | `addGroupMember` / `removeGroupMember` | Mutation | Adds/removes a member and triggers key rotation. |
| **Groups** | `getAllGroups` / `getGroupMembers` / `getMyGroupMembership` | Query | Fetches the user's groups and group membership details. |
| **Keys** | `saveGroupKey` / `rotateGroupKey` | Mutation | Distributes a wrapped group key packet / manually bumps the key version. |
| **Keys** | `getGroupKeyForUser` / `getGroupKeyVersion` | Query | Fetches the caller's wrapped key packet for a version / the group's current version. |
| **Messaging** | `sendMessage` | Mutation | Sends an encrypted message tagged with the active key version. |
| **Messaging** | `getGroupChatHistory` | Query | Fetches a group's encrypted message history. |
| **Messaging** | `messageAdded` | Subscription | Pushes new messages to the group in real time. |
| **Messaging** | `groupMemberAdded` | Subscription | Notifies a user when they are added to a group. |

## Getting Started

### Prerequisites

- Node.js 18+ (20+ recommended)
- A running instance of the companion GraphQL backend

### Installation

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173` by default.

### Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite development server. |
| `npm run build` | Builds the app for production into `dist/`. |
| `npm run preview` | Serves the production build locally. |
| `npm run lint` | Runs ESLint. |

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `VITE_GRAPHQL_HTTP_URL` | `http://localhost:8080/graphql` | GraphQL query/mutation endpoint. |
| `VITE_GRAPHQL_WS_URL` | `ws://localhost:8080/graphql` | GraphQL subscription WebSocket endpoint. |

## Security Notes

- Private keys are generated and used only in the browser and are never sent to the server.
- The server only ever stores ciphertext, IVs, and per-user wrapped group key packets — never plaintext messages or unwrapped group keys.
- The JWT in `sessionStorage` is cleared when the tab/session ends and is not intended for persistent login.
- This is a reference implementation; review refresh-token flow, input validation, and rate limiting on the backend before using in production.
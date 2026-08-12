/// <reference types="vite/client" />

// Ambient declarations so the UI's tsconfig picks them up when it follows
// imports into @gobo/core. Mirrors packages/core/src/strudel.d.ts.
declare module '@strudel/core';
declare module '@strudel/mini';

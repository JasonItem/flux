/// <reference types="vite/client" />

import type { StudioApi } from '../../shared/api'

declare global {
  interface Window {
    studio: StudioApi
  }
}

export {}

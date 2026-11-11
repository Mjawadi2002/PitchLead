/// <reference types="vite/client" />
import type { LeadPitchApi } from '../../preload/index'

declare global {
  interface Window {
    lp: LeadPitchApi
  }
}
export {}

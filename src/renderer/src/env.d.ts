/// <reference types="vite/client" />
import type { LeadpitchApi } from '../../preload/index'

declare global {
  interface Window {
    lp: LeadpitchApi
  }
}
export {}

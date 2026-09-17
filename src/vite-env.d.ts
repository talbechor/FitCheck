/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Plausible site domain. Leave empty to disable analytics entirely. */
  readonly VITE_PLAUSIBLE_DOMAIN?: string;
  /** Plausible script URL (default https://plausible.io/js/script.js). */
  readonly VITE_PLAUSIBLE_SRC?: string;
  /**
   * Hosted Custom Fit waitlist form. The Custom Fit teaser section is always shown;
   * leave this empty to hide only its waitlist button.
   */
  readonly VITE_WAITLIST_URL?: string;
  /** Hosted feedback form. Leave empty to hide the feedback link. */
  readonly VITE_FEEDBACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

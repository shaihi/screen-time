// Windows shell/host processes recorded by agent 1.0. Agent 1.1+ drops them at the source;
// this list keeps older rows out of the app breakdown.
export const systemAppNames = [
  "ApplicationFrameHost",
  "consent",
  "CredentialUIBroker",
  "ctfmon",
  "dwm",
  "explorer",
  "GameBar",
  "GameBarFTServer",
  "gamingservicesui",
  "LockApp",
  "LogonUI",
  "NotificationCenter",
  "PickerHost",
  "RuntimeBroker",
  "ScreenClippingHost",
  "ScreenTime.Agent",
  "SearchApp",
  "SearchHost",
  "SearchUI",
  "ShellExperienceHost",
  "ShellHost",
  "sihost",
  "StartMenuExperienceHost",
  "TextInputHost",
  "UserOOBEBroker",
  "WidgetBoard",
  "Widgets",
] as const;

// Minutes without an upload before the dashboard reports the agent as offline.
export const agentOfflineAfterMinutes = 10;

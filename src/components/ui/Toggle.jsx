// Shared pill-style on/off switch. Extracted from Settings.jsx's
// "Swipe sound effects" row, which had this exact markup/styling
// hand-rolled inline — worth pulling out once NotificationSettings.jsx
// needed the same switch ten more times (see migration
// 075_notification_preferences.sql for the preferences it renders).
// Settings.jsx's own sound toggle was switched over to this component
// too, rather than leaving two copies of the same thing to drift apart.
export default function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        background: disabled ? '#E5E7EB' : (checked ? '#2D3DCA' : '#D1D5DB'),
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        position: 'relative',
        transition: 'background 0.2s ease',
        flexShrink: 0,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: 'white',
          position: 'absolute',
          top: '3px',
          left: checked ? '23px' : '3px',
          transition: 'left 0.2s ease',
        }}
      />
    </button>
  )
}

// Standard "visually hidden but still in the accessibility tree" pattern —
// content is removed from the visual layout (zero footprint, can't affect
// surrounding flex/grid sizing since it's taken out of flow) but still
// readable by screen readers. Used for page <h1>s on screens whose visual
// title is a styled div rather than a real heading, so there's still a
// heading in the DOM for assistive tech to navigate by.
const visuallyHiddenStyle = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

export default function VisuallyHidden({ as: Tag = 'span', children, ...props }) {
  return (
    <Tag style={visuallyHiddenStyle} {...props}>
      {children}
    </Tag>
  )
}

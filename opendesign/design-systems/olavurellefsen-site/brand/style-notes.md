# Visual and interaction foundations

- Public surface: pale green paper, deep green type, fine grey-green rules, generous vertical space.
- Typography: Newsreader for editorial headings and work titles; Manrope for metadata, descriptions, labels, and controls.
- CMS chrome: white or near-white surfaces, 1px borders, 4–6px radii, restrained shadows, coral focus/action state.
- Controls: compact on desktop, minimum 44px touch target on mobile. Use Lucide icons in React and plain arrows only for lightweight in-iframe structural controls.
- Motion: 140–180ms for hover/focus state; no ornamental animation. Respect reduced-motion preferences for scrolling.
- Direct manipulation: structural controls sit beside or immediately after the collection they affect. Secondary attributes such as URLs and accents belong in the right-side inspector.
- Public isolation: every editor-only control is injected only after the preview receives `cms-inline-preview` and must not exist in public server-rendered markup.

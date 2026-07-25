const COVER_SECTION_PATTERN = /(?:^|[./_\-\s])cover(?:page)?(?:$|[./_\-\s])/iu;

function isCoverSection(section) {
  const properties = Array.isArray(section?.properties)
    ? section.properties.join(' ')
    : String(section?.properties || '');
  return COVER_SECTION_PATTERN.test([
    section?.href,
    section?.idref,
    properties,
  ].filter(Boolean).join(' '));
}

export function initialReadingTarget(spine, savedProgress) {
  if (typeof savedProgress === 'string' && savedProgress.trim()) return savedProgress;

  const sections = Array.isArray(spine?.spineItems) ? spine.spineItems : [];
  const firstReadable = sections.find((section) => section?.linear !== false && !isCoverSection(section))
    || sections.find((section) => !isCoverSection(section));

  return firstReadable?.href;
}

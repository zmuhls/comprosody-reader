const COVER_SECTION_PATTERN = /(?:^|[./_\-\s])cover(?:page)?(?:$|[./_\-\s])/iu;

export function isCoverSection(section) {
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
  const sections = Array.isArray(spine?.spineItems) ? spine.spineItems : [];
  if (typeof savedProgress === 'string' && savedProgress.trim()) {
    let savedSection;
    try {
      savedSection = typeof spine?.get === 'function' ? spine.get(savedProgress) : undefined;
    } catch {
      savedSection = undefined;
    }
    if (!savedSection || !isCoverSection(savedSection)) return savedProgress;
  }

  const firstReadable = sections.find((section) => section?.linear !== false && !isCoverSection(section))
    || sections.find((section) => !isCoverSection(section));

  return firstReadable?.href;
}

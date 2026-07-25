import assert from 'node:assert/strict';
import test from 'node:test';

import { initialReadingTarget } from '../public/reader-navigation.js';

test('starts at the first readable spine item when no progress is stored', () => {
  const spine = {
    spineItems: [
      { idref: 'coverpage', href: 'cover.xhtml', linear: true },
      { idref: 's1', href: 'section-01.xhtml', linear: true },
      { idref: 's2', href: 'section-02.xhtml', linear: true },
    ],
  };

  assert.equal(initialReadingTarget(spine, null), 'section-01.xhtml');
});

test('restores stored progress instead of replacing it with the first text section', () => {
  const savedProgress = 'epubcfi(/6/4!/4/2/2/1:18)';
  const spine = {
    spineItems: [
      { idref: 'coverpage', href: 'cover.xhtml', linear: true },
      { idref: 's1', href: 'section-01.xhtml', linear: true },
    ],
  };

  assert.equal(initialReadingTarget(spine, savedProgress), savedProgress);
});

test('recognizes a cover from its spine id or properties', () => {
  const spine = {
    spineItems: [
      { idref: 'cover-page', href: 'frontmatter.xhtml', linear: true },
      { idref: 'chapter-one', href: 'chapter-01.xhtml', linear: true },
    ],
  };

  assert.equal(initialReadingTarget(spine, undefined), 'chapter-01.xhtml');
});

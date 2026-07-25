import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialReadingTarget,
  pageTurnForArrow,
} from '../public/reader-navigation.js';

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

test('repairs a stored cover CFI by opening the first readable section', () => {
  const coverProgress = 'epubcfi(/6/2!/4/2/2/1:0)';
  const spine = {
    spineItems: [
      { idref: 'coverpage', href: 'cover.xhtml', linear: false },
      { idref: 's1', href: 'section-01.xhtml', linear: true },
    ],
    get(target) {
      return target === coverProgress ? this.spineItems[0] : null;
    },
  };

  assert.equal(initialReadingTarget(spine, coverProgress), 'section-01.xhtml');
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

test('maps unmodified arrow keys to paginated reading direction', () => {
  assert.equal(pageTurnForArrow({
    key: 'ArrowLeft',
    readerActive: true,
  }), 'prev');
  assert.equal(pageTurnForArrow({
    key: 'ArrowRight',
    readerActive: true,
  }), 'next');
  assert.equal(pageTurnForArrow({
    key: 'ArrowLeft',
    direction: 'rtl',
    readerActive: true,
  }), 'next');
  assert.equal(pageTurnForArrow({
    key: 'ArrowRight',
    direction: 'RTL',
    readerActive: true,
  }), 'prev');
});

test('does not turn pages while another interaction owns the arrow keys', () => {
  const guardedFields = [
    'modified',
    'repeat',
    'composing',
    'defaultPrevented',
    'interactive',
    'selectionActive',
    'overlayOpen',
  ];
  for (const field of guardedFields) {
    assert.equal(pageTurnForArrow({
      key: 'ArrowRight',
      readerActive: true,
      [field]: true,
    }), null, `${field} must retain the arrow key`);
  }
  assert.equal(pageTurnForArrow({ key: 'ArrowRight', readerActive: false }), null);
  assert.equal(pageTurnForArrow({ key: 'PageDown', readerActive: true }), null);
});

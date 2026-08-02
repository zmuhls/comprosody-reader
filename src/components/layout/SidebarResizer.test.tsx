import { fireEvent, render, screen } from '@testing-library/react';
import { clampSidebarWidth } from '../../lib/sidebarWidth';
import { SidebarResizer } from './SidebarResizer';

describe('SidebarResizer', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--sidebar-width');
  });

  it('clamps stored and dragged widths to a usable range', () => {
    expect(clampSidebarWidth(20)).toBe(188);
    expect(clampSidebarWidth(284.4)).toBe(284);
    expect(clampSidebarWidth(900)).toBe(380);
  });

  it('supports keyboard resizing and persists the chosen width', () => {
    render(<SidebarResizer />);
    const separator = screen.getByRole('separator', {
      name: 'Resize note directory',
    });

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('240');
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe(
      '240px',
    );
    expect(localStorage.getItem('comprosody:sidebar-width')).toBe('240');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator.getAttribute('aria-valuenow')).toBe('380');
  });
});

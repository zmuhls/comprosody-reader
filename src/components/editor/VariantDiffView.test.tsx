import { render, screen } from '@testing-library/react';
import { VariantDiffView } from './VariantDiffView';

describe('VariantDiffView', () => {
  it('marks insertions green and removals struck-through', () => {
    render(<VariantDiffView oldText="the cat sat" newText="the dog sat" />);

    const added = screen.getByText('dog');
    expect(added).toHaveClass('text-success');

    const removed = screen.getByText('cat');
    expect(removed).toHaveClass('line-through');
  });

  it('leaves unchanged text unstyled', () => {
    render(<VariantDiffView oldText="same words" newText="same words" />);
    const unchanged = screen.getByText('same words');
    expect(unchanged.className).toBe('');
  });
});

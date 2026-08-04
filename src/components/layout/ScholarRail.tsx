import { Icon } from '../ui/Icon';
import { Tooltip } from 'radix-ui';

export function ScholarRail({ inert = false }: { inert?: boolean }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <aside
          aria-label="Scholar search is planned for a later release"
          className="scholar-rail"
          inert={inert ? true : undefined}
        >
          <Icon name="search" size={15} />
        </aside>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="ui-tooltip" side="left" sideOffset={8}>
          Scholar search · Later
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

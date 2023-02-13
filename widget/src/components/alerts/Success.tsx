import React from 'react';
import classNames from 'classnames';

const Success = (props: React.ComponentPropsWithoutRef<'div'>) =>
    <div
        {...props}
        className={classNames(
            'bg-white',
            'p-4', 'rounded-lg',
            'border', 'border-grey-50',
            props.className,
        )}
    >
        { props.children }
    </div>;

export { Success };

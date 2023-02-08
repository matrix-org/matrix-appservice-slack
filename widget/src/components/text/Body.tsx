import React from 'react';
import classNames from 'classnames';

const Body = (props: React.ComponentPropsWithoutRef<'p'>) =>
    <p {...props} className={classNames('text-normal', 'font-normal', props.className)}/>;

export { Body };

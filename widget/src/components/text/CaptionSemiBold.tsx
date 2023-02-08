import React from 'react';
import classNames from 'classnames';

const CaptionSemiBold = (props: React.ComponentPropsWithoutRef<'h4'>) =>
    <h4 {...props} className={classNames('text-sm', 'font-semibold', props.className as string)}/>;

export { CaptionSemiBold };

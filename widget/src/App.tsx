import React from 'react';

import { ProvisioningApp } from './ProvisioningApp';
import { SlackApp } from './SlackApp';

const App = () => {
    return <ProvisioningApp
        tokenName='slack-sessionToken'
    >
        <SlackApp/>
    </ProvisioningApp>;
};

export default App;

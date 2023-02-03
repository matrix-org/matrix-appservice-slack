import React from 'react';
import { ProvisioningApp } from './ProvisioningApp';

const App = () => {
    return <ProvisioningApp
        apiPrefix='/_matrix/provision'
        tokenName='slack-sessionToken'
    >
        Ready!
    </ProvisioningApp>;
};

export default App;

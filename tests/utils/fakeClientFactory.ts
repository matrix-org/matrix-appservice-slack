export class FakeClientFactory {
    public async getClientForUser(): Promise<Record<string, unknown>> {
        return {};
    }
}
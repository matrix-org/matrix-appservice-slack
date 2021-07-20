export class FakeExpressResponse {
    public Status = 200;
    public Json: Record<string, unknown> = {};
    constructor() { }

    public status(s: number): FakeExpressResponse {
        this.Status = s;
        return this;
    }

    public json(json: Record<string, unknown>): FakeExpressResponse {
        this.Json = json;
        return this;
    }
}

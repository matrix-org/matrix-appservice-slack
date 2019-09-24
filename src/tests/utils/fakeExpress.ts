// tslint:disable: no-any

export class FakeExpressResponse {
    public Status: number = 200;
    public Json: any = {};
    constructor() { }

    public status(s: number): FakeExpressResponse {
        this.Status = s;
        return this;
    }

    public json(json: any): FakeExpressResponse {
        this.Json = json;
        return this;
    }
}

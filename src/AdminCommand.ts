var minimist = require("minimist");

interface IAdminCommandOptsDescribed extends IAdminCommandOpsSpec {
    desc: string;
    required: boolean;
    boolean: boolean;
}

interface IAdminCommandOptsSpecAliases extends IAdminCommandOptsDescribed {
    aliases: string[];
}

export class AdminCommand {
    private readonly optspec: {[name: string]: IAdminCommandOptsDescribed};
    private readonly optaliases: {[name: string]: string};
    private readonly stringArgs: string[];
    private readonly booleanArgs: string[];
    constructor(public readonly desc: string, private func: () => any,
        opts?: {[name: string]: IAdminCommandOptsSpecAliases}) {
        this.optspec = {};
        this.optaliases = {};

        // It's assumed that you won't have any args if you have no opts.
        if (!opts) {
            return;
        }

        Object.keys(opts).forEach((name) => {
            const def = opts[name];

            this.optspec[name] = {
                desc: def.desc,
                required: def.required || false,
                boolean: def.boolean || false,
            }

            if (def.aliases) {
                def.aliases.forEach((a) => this.optaliases[a] = name);
            }
        });

        this.stringArgs = Object.keys(this.optspec).filter(
            (n) => !this.optspec[n].boolean);
        this.booleanArgs = Object.keys(this.optspec).filter(
            (n) => this.optspec[n].boolean);
    }

    public run(main, args, respond) {
        var opts = minimist(args, {
            string: this.string_args,
            boolean: this.boolean_args,
        });
    
        args = opts._;
        delete opts["_"];
    
        // Canonicalise aliases
        Object.keys(this.optaliases).forEach((a) => {
            if (a in opts) {
                opts[this.optaliases[a]] = opts[a];
                delete opts[a];
            }
        });
    
        Object.keys(opts).forEach((n) => {
            if (n === "_") return;
    
            if (!(n in this.optspec)) {
                throw Error("Unrecognised argument: " + n);
            }
        });
    
        // Parse the positional arguments first so we can complain about any
        // missing ones in order
        if (this.argspec) {
            // In current implementation, every positional argument is required
            var missing = false;
    
            this.argspec.forEach((name) => {
                if (opts[name] !== undefined ||
                    !args.length) {
                    missing = true;
                    return;
                }
    
                opts[name] = args.shift();
            });
    
            if (missing) {
                throw Error("Required arguments: " + this.argspec.join(" "));
            }
        }
    
        var missing = [];
        Object.keys(this.optspec).sort().forEach((n) => {
            if (this.optspec[n].required && !(n in opts)) missing.push("--" + n);
        });
    
        if (missing.length) {
            throw Error("Missing required options: " + missing.join(", "));
        }
    
        return this._func(main, opts, args, respond);    
    }

    public static makeHelpCommand(commands: AdminCommand[]) {
        return new AdminCommand({
            desc: "display a list of commands",
            func: function(main, opts, args, respond) {
                if (args.length == 0) {
                    Object.keys(commands).sort().forEach(function (k) {
                        var cmd = commands[k];
                        respond(k + ": " + cmd.desc);
                    });
                }
                else {
                    var name = args.shift();
                    var cmd = commands[name];
                    if (!cmd) {
                        throw Error("No such command '" + name + "'");
                    }
    
                    respond(name + " - " + cmd.desc);
                    var argspec = cmd.argspec || [];
                    if(argspec.length) {
                        respond("Arguments: " + argspec.map(
                                (n) => "[" + n.toUpperCase() + "]"
                            ).join(" "));
                    }
                    var optspec = cmd.optspec || {};
                    Object.keys(optspec).sort().forEach((n) => {
                        respond("  --" + n + ": " + optspec[n].desc);
                    });
                }
            },
        });
    }
}
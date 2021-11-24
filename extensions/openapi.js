`use strict`

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch"];

const marked_p = {
    paragraph(text) {
        return `<div class="paragraph"><p>${text}</p></div>`;
    }
};

class Openapi {
    static register({config}) {
        new Openapi(this, config)
    }

    constructor(generatorContext, config) {
        this.context = generatorContext
        this.config = config
        this.logger = this.context.require('@antora/logger')('openapi')

        const marked = this.context.require("marked");
        marked.use({renderer: marked_p});
        this.marked = marked;

        this.context
            .on('contentClassified', this.onContentClassified.bind(this))
            .on('playbookBuilt', this.onPlaybookBuilt.bind(this))
    }

    onPlaybookBuilt({playbook}) {
        this.baseDir = playbook.dir || "."
    }

    async onContentClassified({playbook, contentCatalog}) {
        this.logger.debug(`Config: ${JSON.stringify(this.config)}`)
        this.logger.debug(`Content classified: ${contentCatalog}`)

        for (let query of this.config.queries) {
            query = Object.assign({}, query, {family: "attachment"});
            // query = {family: "page"};
            this.logger.debug(`Query: ${JSON.stringify(query)}`);
            const found = contentCatalog.findBy(query);
            for (const doc of found) {
                this.logger.trace(`File: ${JSON.stringify(doc, null, 2)}`);
                if (doc.mediaType === "text/yaml") {
                    await this.processSpec(contentCatalog, doc)
                }
            }
        }
    }

    async processSpec(contentCatalog, spec) {
        const path = this.context.require('path');

        const target = path.join(path.dirname(path.dirname(spec.src.abspath)), "pages");
        const targetFile = path.join(target, spec.src.stem + ".adoc");

        this.logger.debug(`Output: ${target}`);

        await this.renderSpec(contentCatalog, spec);
    }

    async renderSpec(contentCatalog, spec) {
        const SwaggerParser = this.context.require("@apidevtools/swagger-parser");

        const api = await SwaggerParser.parse(spec.src.abspath);
        const $refs = await SwaggerParser.resolve(spec.src.abspath);

        this.logger.info("API name: %s, Version: %s", api.info.title, api.info.version);

        this.logger.debug(`API: ${JSON.stringify(api, null, 2)}`)

        api.groups = this.group(api);
        this.internalizeAll(api, $refs);

        this.logger.debug(`API(after): ${JSON.stringify(api, null, 2)}`)

        await this.renderTo(contentCatalog, spec, api, $refs, "index");
        await this.renderTo(contentCatalog, spec, api, $refs, "endpoints");
        await this.renderTo(contentCatalog, spec, api, $refs, "schemas");
    }

    async renderTo(contentCatalog, source, api, $refs, name ) {

        const src = Object.assign({}, source.src, {
            family: 'page',
            mediaType: 'text/asciidoc'
        });
        src.extname = '.adoc'
        src.stem = name;
        const filename = src.stem + src.extname;
        src.relative = src.relative.slice(0, src.relative.length - src.basename.length) + filename
        src.basename = src.stem + src.extname;

        const dirname = source.dirname;
        const path = source.path;

        const template = `templates/${name}.adoc`;
        const nunjucks = this.context.require("nunjucks");

        this.logger.debug(`Rendering: ${JSON.stringify(source.src, null, 2)} ...`)

        const output = nunjucks.render(template, {
            api,
            $refs,
            resolve: (ref) => {
                return $refs.get(ref);
            },
            schemaName: (ref) => {
                if (ref.startsWith('#/components/schemas/')) {
                    return ref.slice('#/components/schemas/'.length);
                } else {
                    return ref;
                }
            },
            autoId: (title) => {
                return "_" + title
                    .toLowerCase()
            },
            markdown: (markdown) => {
                if (markdown) {
                    return "++++\n" +  this.marked.parse(markdown) + "\n++++\n";
                } else {
                    return "";
                }
            },
            contains: (list, ele) => {
                if (list) {
                    return list.includes(ele);
                } else {
                    return false;
                }
            },
            isSimpleType: (type) => {
                return this.isSimpleType(type);
            },
        });

        const file = {
            src,
            dirname,
            path,
            mediaType: "text/asciidoc",
            contents: Buffer.from(output),
        };

        this.logger.debug(`Adding: ${JSON.stringify(file.src, null, 2)} ... done!`)
        this.logger.debug(output);

        contentCatalog.addFile(file)
    }

    isSimpleType(schema) {
        const t = schema?.type;
        if ( t === undefined ){
            return false;
        } else if (["string", "number", "integer", "boolean", "null", "array"].includes(t)) {
            return true;
        } else if ( t === "object" && schema.properties === undefined ) {
            return true;
        } else {
            // otherwise, false
            return false;
        }
    }

    group(api) {
        let groups = {};
        for (const path in api.paths) {
            for (const m of METHODS) {
                const method = api.paths[path][m];
                if (method === undefined) {
                    continue;
                }

                const tags = method.tags;
                if (tags === undefined) {
                    this.addGroup(api, groups, "Common", path, m)
                } else {
                    for (const tag of tags) {
                        this.addGroup(api, groups, tag, path, m)
                    }
                }
            }
        }
        return groups;
    }

    addGroup(api, groups, tag, path, method) {
        groups[tag] = groups[tag] || {};
        groups[tag][path] = groups[tag][path] || {
            parameters: api.paths[path].parameters,
            methods: {},
        };
        groups[tag][path].methods[method] = api.paths[path][method];
    }

    /**
     * Internalize all localized schemas into the schema section.
     */
    internalizeAll(api, $refs) {
        // paths
        for (const p in api.paths) {
            for (const m of METHODS) {
                this.internalize(api,$refs,p,m);
            }
        }
        // schemas
        for (const [name, schema] of Object.entries(api.components.schemas)) {
            if (schema.type === "object" && schema.properties !== undefined) {
                for (const [prop, prop_spec] of Object.entries(schema.properties) ) {
                    const prefix = name + "_" + prop;
                    schema.properties[prop] = Object.assign({
                        description: prop_spec.description,
                    }, this.internalizeSchema(api, $refs, prefix, prop_spec));
                }
            }
        }
    }

    internalize(api, $refs, p, m) {

        let pId = p.replace(/\w*\W*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
        pId = pId.replace(/\W+/g, "");
        const mId = m.charAt(0).toUpperCase() + m.slice(1);

        const method = api.paths[p][m];

        for (const code in method?.responses) {
            const spec = method?.responses[code];
            for (const ct in spec?.content) {
                const ct_spec = spec?.content[ct];

                let ctId = ct.replace(/\w*\W*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
                ctId = ctId.replace(/\W/g, "");
                const name = `Response${pId}${mId}${code}${ctId}`;

                ct_spec.schema = this.internalizeSchema(api, $refs, name, ct_spec.schema);
            }
        }

        for (const ct in method?.requestBody?.content) {
            const ct_spec = method?.requestBody?.content[ct];

            let ctId = ct.replace(/\w*\W*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
            ctId = ctId.replace(/\W/g, "");
            const name = `RequestBody${pId}${mId}${ctId}`;

            ct_spec.schema = this.internalizeSchema(api, $refs, name, ct_spec.schema);
        }
    }

    internalizeSchema(api, $refs, prefix, schema) {

        if (schema === undefined || schema.$ref !== undefined) {
            return schema;
        }

        this.logger.debug(`${prefix}: ${JSON.stringify(schema)}`);

        if (!this.isSimpleType(schema)) {
            const $ref = this.addNewSchema(api, $refs, prefix, schema);
            schema = {$ref};
        } else if (schema?.type === "array" && schema?.items.$ref === undefined && !this.isSimpleType(schema?.items)) {
            const name = prefix + "Items";
            const $ref = this.addNewSchema(api, $refs, name, schema.items);
            schema.items = {$ref};
        }

        this.logger.debug(`${prefix} (after): ${JSON.stringify(schema)}`);

        return schema;
    }

    addNewSchema(api, $refs, name, schema) {
        const id = "#/components/schemas/" + name;
        $refs.set(id, schema);
        api.components.schemas[name] = schema;
        return id;
    }

}

module.exports = Openapi;

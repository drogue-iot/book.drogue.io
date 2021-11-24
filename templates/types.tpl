
{%- macro type(spec) -%}

{%- if spec.$ref -%}
xref:schemas#{{ autoId(schemaName(spec.$ref)) }}[{{ schemaName(spec.$ref) }}]

{%- elif spec.type == "object" and spec.properties === undefined %}

{% if spec.additionalProperties === undefined or spec.additionalProperties === true or spec.additionalProperties === {} %}
Map of objects
{% else %}
Map of {{ type(spec.additionalProperties) }}
{% endif %}

{%- elif spec.type == "object" %}
{{ object(spec) }}

{% elif spec.type == "array" %}
List of {{ type(spec.items) }}

{% elif spec.type %}
{% include "templates/types/basic.adoc" %}

{% elif spec.oneOf %}
{{ oneOf(spec.oneOf) }}

{% elif spec.allOf %}
{{ allOf(spec.allOf) }}

{% else %}
Unknown

{% endif -%}


{% endmacro -%}



{%- macro object(schema) -%}

[%autowidth.stretch, frame=none, grid=rows]
|===
| Property | Type | Description

{% for name,p in schema.properties %}

{% if contains(schema.required, name) %}
a|
[pass]
<b title="required">{{ name }}*</b>
{% else %}
| {{name}}
{% endif %}

| {{type(p)}}
a| {{ prop_description(p) }}

{% endfor %}

|===

{%- endmacro -%}


{%- macro prop_description(schema) -%}

{% if schema.description %}
{{ markdown(schema.description) | safe }}

{% elif schema.items.description %}
{{ markdown("Each: " + schema.items.description) | safe }}

{% endif %}

{% if schema.enum %}
{% for lit in schema.enum %}
* `{{ lit }}`
{% endfor %}
{%- endif -%}

{%- endmacro -%}

{%- macro ofList(label, list) -%}
{{label}}:

{% for i in list %}
* {empty}
+
--
{{ type(i) }}
--
{% endfor %}

{%- endmacro -%}

{%- macro oneOf(list) -%}{{ ofList("One of", list) }}{%- endmacro -%}
{%- macro allOf(list) -%}{{ ofList("All of", list) }}{%- endmacro -%}

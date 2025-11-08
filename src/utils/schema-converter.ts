import { z } from "zod";
import { InputSchema, Property } from "../types";

/**
 * JSON Schema to Zod Schema Converter
 * Converts tool InputSchema (JSON Schema format) to Zod validation schemas
 *
 * This utility eliminates code duplication and provides a clean separation
 * of schema conversion logic from the main server registration code.
 */
export class SchemaToZodConverter {
    /**
     * Convert entire InputSchema to Zod object schema
     *
     * @param inputSchema - Tool input schema in JSON Schema format
     * @returns Zod schema object ready for registerTool()
     */
    convert(inputSchema: InputSchema): Record<string, z.ZodTypeAny> {
        const zodSchema: Record<string, z.ZodTypeAny> = {};
        const properties = inputSchema.properties;

        for (const [key, prop] of Object.entries(properties)) {
            zodSchema[key] = this.convertProperty(prop, key, inputSchema.required);
        }

        return zodSchema;
    }

    /**
     * Convert a single JSON Schema property to Zod type
     *
     * @param prop - Property definition from JSON Schema
     * @param key - Property name
     * @param required - Array of required property names
     * @returns Zod type with appropriate validation
     */
    private convertProperty(
        prop: Property,
        key: string,
        required?: string[]
    ): z.ZodTypeAny {
        let zodType = this.convertBaseType(prop);

        // Add description
        if (prop.description) {
            zodType = zodType.describe(prop.description);
        }

        // Make optional if not required
        if (!required?.includes(key)) {
            zodType = zodType.optional();
        }

        return zodType;
    }

    /**
     * Convert base JSON Schema type to Zod type
     *
     * @param prop - Property definition
     * @returns Base Zod type with constraints
     */
    private convertBaseType(prop: Property): z.ZodTypeAny {
        switch (prop.type) {
            case "string":
                return this.convertStringType(prop);

            case "number":
                return this.convertNumberType(prop);

            case "boolean":
                return z.boolean();

            case "array":
                return this.convertArrayType(prop);

            case "object":
                return this.convertObjectType(prop);

            default:
                return z.any();
        }
    }

    /**
     * Convert string property with enum support
     */
    private convertStringType(prop: Property): z.ZodTypeAny {
        if (prop.enum && prop.enum.length > 0) {
            return z.enum(prop.enum as [string, ...string[]]);
        }
        return z.string();
    }

    /**
     * Convert number property with min/max constraints
     */
    private convertNumberType(prop: Property): z.ZodTypeAny {
        let numType = z.number();

        if (prop.minimum !== undefined) {
            numType = numType.min(prop.minimum);
        }
        if (prop.maximum !== undefined) {
            numType = numType.max(prop.maximum);
        }

        return numType;
    }

    /**
     * Convert array property with item validation
     */
    private convertArrayType(prop: Property): z.ZodTypeAny {
        if (prop.items) {
            const itemType = this.convertBaseType(prop.items);
            return z.array(itemType);
        }
        return z.array(z.any());
    }

    /**
     * Convert object property with nested properties
     */
    private convertObjectType(prop: Property): z.ZodTypeAny {
        if (prop.properties) {
            const nestedSchema: Record<string, z.ZodTypeAny> = {};

            for (const [nestedKey, nestedProp] of Object.entries(prop.properties)) {
                nestedSchema[nestedKey] = this.convertProperty(
                    nestedProp,
                    nestedKey,
                    prop.required
                );
            }

            return z.object(nestedSchema);
        }
        return z.object({});
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { CommonError } from ".";

export function expectGet<K, V>(map: Map<K, V>, key: K): V {
    const maybeValue: V | undefined = map.get(key);
    if (maybeValue === undefined) {
        const details: {} = { key };
        throw new CommonError.InvariantError(`key not found in given map`, details);
    }
    return maybeValue;
}

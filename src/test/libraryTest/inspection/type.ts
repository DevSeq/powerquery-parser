// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import "mocha";
import { Inspection } from "../../..";
import { ResultUtils } from "../../../common";
import { Position, ScopeTypeByKey, TriedScopeType } from "../../../inspection";
import { ActiveNode, ActiveNodeUtils } from "../../../inspection/activeNode";
import { Ast } from "../../../language";
import { IParserState, NodeIdMap, ParseError, ParseOk } from "../../../parser";
import { CommonSettings, DefaultSettings } from "../../../settings";
import { Type } from "../../../type";
import { expectDeepEqual, expectParseErr, expectParseOk, expectTextWithPosition } from "../../common";

type AbridgedScopeType = Type.TType;

function expectScopeTypeOk(
    settings: CommonSettings,
    nodeIdMapCollection: NodeIdMap.Collection,
    leafNodeIds: ReadonlyArray<number>,
    position: Position,
): ScopeTypeByKey {
    const maybeActiveNode: ActiveNode | undefined = ActiveNodeUtils.maybeActiveNode(
        nodeIdMapCollection,
        leafNodeIds,
        position,
    );
    if (!(maybeActiveNode !== undefined)) {
        throw new Error(`AssertedFailed: maybeActiveNode !== undefined`);
    }
    const activeNode: ActiveNode = maybeActiveNode;

    const triedScope: Inspection.TriedScope = Inspection.tryScope(
        settings,
        nodeIdMapCollection,
        leafNodeIds,
        activeNode.ancestry,
        undefined,
    );
    if (!ResultUtils.isOk(triedScope)) {
        throw new Error(`AssertFailed: ResultUtils.isOk(triedScope) - ${triedScope.error}`);
    }

    const triedScopeType: TriedScopeType = Inspection.tryScopeTypeForRoot(
        settings,
        nodeIdMapCollection,
        leafNodeIds,
        triedScope.value,
        activeNode.ancestry,
        undefined,
    );
    if (!ResultUtils.isOk(triedScopeType)) {
        throw new Error(`AssertFailed: ResultUtils.isOk(triedScopeType) - ${triedScopeType.error}`);
    }

    return triedScopeType.value;
}

function actualFactoryFn(inspected: ScopeTypeByKey): Type.TType {
    const maybeBar: Type.TType | undefined = inspected.get("__bar");
    if (!(maybeBar !== undefined)) {
        throw new Error(`AssertFailed: maybebar !== undefined`);
    }

    return maybeBar;
}

function wrapExpression(expression: string): string {
    return `let __foo = |__bar, __bar = ${expression} in _`;
}

function expectParseOkTypeOk(expression: string, expected: AbridgedScopeType): void {
    const [text, position]: [string, Inspection.Position] = expectTextWithPosition(wrapExpression(expression));
    const parseOk: ParseOk<IParserState> = expectParseOk(DefaultSettings, text);
    const scopeTypeMap: ScopeTypeByKey = expectTypeOk(
        DefaultSettings,
        parseOk.nodeIdMapCollection,
        parseOk.leafNodeIds,
        position,
    );
    expectDeepEqual(scopeTypeMap, expected, actualFactoryFn);
}

function expectParseErrTypeOk(expression: string, expected: AbridgedScopeType): void {
    const [text, position]: [string, Inspection.Position] = expectTextWithPosition(wrapExpression(expression));
    const parseErr: ParseError.ParseError<IParserState> = expectParseErr(DefaultSettings, text);
    const scopeTypeMap: ScopeTypeByKey = expectTypeOk(
        DefaultSettings,
        parseErr.state.contextState.nodeIdMapCollection,
        parseErr.state.contextState.leafNodeIds,
        position,
    );
    expectDeepEqual(scopeTypeMap, expected, actualFactoryFn);
}

function expectTypeOk(
    settings: CommonSettings,
    nodeIdMapCollection: NodeIdMap.Collection,
    leafNodeIds: ReadonlyArray<number>,
    position: Position,
): ScopeTypeByKey {
    return expectScopeTypeOk(settings, nodeIdMapCollection, leafNodeIds, position);
}

function expectSimpleExpressionType(expression: string, kind: Type.TypeKind, isNullable: boolean): void {
    const expected: Type.TType = {
        kind,
        maybeExtendedKind: undefined,
        isNullable,
    };
    expectParseOkTypeOk(expression, expected);
}

describe(`Inspection - Scope - Type`, () => {
    describe("BinOpExpression", () => {
        it(`1 + 1`, () => {
            expectSimpleExpressionType(`1 + 1`, Type.TypeKind.Number, false);
        });

        it(`true and false`, () => {
            expectSimpleExpressionType(`true and false`, Type.TypeKind.Logical, false);
        });

        it(`"hello" & "world"`, () => {
            expectSimpleExpressionType(`"hello" & "world"`, Type.TypeKind.Text, false);
        });

        it(`true + 1`, () => {
            expectSimpleExpressionType(`true + 1`, Type.TypeKind.None, false);
        });
    });

    describe(`${Ast.NodeKind.IdentifierExpression}`, () => {
        it(`let x = true in x`, () => {
            expectSimpleExpressionType("let x = true in x", Type.TypeKind.Logical, false);
        });

        it(`let x = 1 in x`, () => {
            expectSimpleExpressionType("let x = 1 in x", Type.TypeKind.Number, false);
        });
    });

    describe(`${Ast.NodeKind.LiteralExpression}`, () => {
        it(`true`, () => {
            expectSimpleExpressionType("true", Type.TypeKind.Logical, false);
        });

        it(`false`, () => {
            expectSimpleExpressionType("false", Type.TypeKind.Logical, false);
        });

        it(`1`, () => {
            expectSimpleExpressionType("1", Type.TypeKind.Number, false);
        });

        it(`null`, () => {
            expectSimpleExpressionType("null", Type.TypeKind.Null, true);
        });

        it(`{}`, () => {
            expectSimpleExpressionType("{}", Type.TypeKind.List, false);
        });

        it(`[]`, () => {
            const expression: string = `[]`;
            const expected: Type.TType = {
                kind: Type.TypeKind.Record,
                maybeExtendedKind: Type.ExtendedTypeKind.DefinedRecordExpression,
                isNullable: false,
                fields: new Map(),
            };
            expectParseOkTypeOk(expression, expected);
        });
    });

    describe(`${Ast.NodeKind.IfExpression}`, () => {
        it(`if true then 1 else false`, () => {
            const expression: string = `if true then 1 else false`;
            const expected: Type.TType = {
                kind: Type.TypeKind.Any,
                maybeExtendedKind: Type.ExtendedTypeKind.AnyUnion,
                isNullable: false,
                unionedTypePairs: [
                    {
                        kind: Type.TypeKind.Number,
                        maybeExtendedKind: undefined,
                        isNullable: false,
                    },
                    {
                        kind: Type.TypeKind.Logical,
                        maybeExtendedKind: undefined,
                        isNullable: false,
                    },
                ],
            };
            expectParseOkTypeOk(expression, expected);
        });

        it(`if if true then true else false then 1 else 0`, () => {
            const expression: string = `if if true then true else false then 1 else ""`;
            const expected: AbridgedScopeType = {
                kind: Type.TypeKind.Any,
                maybeExtendedKind: Type.ExtendedTypeKind.AnyUnion,
                isNullable: false,
                unionedTypePairs: [
                    {
                        kind: Type.TypeKind.Number,
                        maybeExtendedKind: undefined,
                        isNullable: false,
                    },
                    {
                        kind: Type.TypeKind.Text,
                        maybeExtendedKind: undefined,
                        isNullable: false,
                    },
                ],
            };
            expectParseOkTypeOk(expression, expected);
        });

        it(`if`, () => {
            const expression: string = `if`;
            const expected: AbridgedScopeType = {
                kind: Type.TypeKind.None,
                maybeExtendedKind: undefined,
                isNullable: false,
            };
            expectParseErrTypeOk(expression, expected);
        });

        it(`if true then 1`, () => {
            const expression: string = `if true then 1`;
            const expected: AbridgedScopeType = {
                kind: Type.TypeKind.Any,
                maybeExtendedKind: Type.ExtendedTypeKind.AnyUnion,
                isNullable: false,
                unionedTypePairs: [
                    {
                        kind: Type.TypeKind.Number,
                        maybeExtendedKind: undefined,
                        isNullable: false,
                    },
                    {
                        kind: Type.TypeKind.Unknown,
                        maybeExtendedKind: undefined,
                        isNullable: false,
                    },
                ],
            };
            expectParseErrTypeOk(expression, expected);
        });
    });

    describe(`${Ast.NodeKind.RecordExpression}`, () => {
        it(`[foo=1] & [bar=2]`, () => {
            const expression: string = `[foo=1] & [bar=2]`;
            const expected: AbridgedScopeType = {
                kind: Type.TypeKind.Record,
                maybeExtendedKind: Type.ExtendedTypeKind.DefinedRecordExpression,
                isNullable: false,
                fields: new Map([
                    [
                        "foo",
                        {
                            kind: Type.TypeKind.Number,
                            maybeExtendedKind: undefined,
                            isNullable: false,
                        },
                    ],
                    [
                        "bar",
                        {
                            kind: Type.TypeKind.Number,
                            maybeExtendedKind: undefined,
                            isNullable: false,
                        },
                    ],
                ]),
            };
            expectParseOkTypeOk(expression, expected);
        });

        it(`[] & [bar=2]`, () => {
            const expression: string = `[] & [bar=2]`;
            const expected: AbridgedScopeType = {
                kind: Type.TypeKind.Record,
                maybeExtendedKind: Type.ExtendedTypeKind.DefinedRecordExpression,
                isNullable: false,
                fields: new Map([
                    [
                        "bar",
                        {
                            kind: Type.TypeKind.Number,
                            maybeExtendedKind: undefined,
                            isNullable: false,
                        },
                    ],
                ]),
            };
            expectParseOkTypeOk(expression, expected);
        });

        it(`[foo=1] & []`, () => {
            const expression: string = `[foo=1] & []`;
            const expected: AbridgedScopeType = {
                kind: Type.TypeKind.Record,
                maybeExtendedKind: Type.ExtendedTypeKind.DefinedRecordExpression,
                isNullable: false,
                fields: new Map([
                    [
                        "foo",
                        {
                            kind: Type.TypeKind.Number,
                            maybeExtendedKind: undefined,
                            isNullable: false,
                        },
                    ],
                ]),
            };
            expectParseOkTypeOk(expression, expected);
        });

        it(`[foo=1] & [foo=""]`, () => {
            const expression: string = `[foo=1] & [foo=""]`;
            const expected: AbridgedScopeType = {
                kind: Type.TypeKind.Record,
                maybeExtendedKind: Type.ExtendedTypeKind.DefinedRecordExpression,
                isNullable: false,
                fields: new Map([
                    [
                        "foo",
                        {
                            kind: Type.TypeKind.Text,
                            maybeExtendedKind: undefined,
                            isNullable: false,
                        },
                    ],
                ]),
            };
            expectParseOkTypeOk(expression, expected);
        });
    });

    describe(`${Ast.NodeKind.RecursivePrimaryExpression}`, () => {
        it(`let foo = (x as number) as number => if x > 0 then @foo(x - 1) else 0 in foo(0)`, () => {
            expectSimpleExpressionType(
                "let foo = (x as number) as number => if x > 0 then @foo(x - 1) else 0 in foo(0)",
                Type.TypeKind.Number,
                false,
            );
        });

        it(`let foo = (x as number) => if x > 0 then @foo(x - 1) else 0 in foo(0)`, () => {
            expectSimpleExpressionType(
                "let foo = (x as number) => if x > 0 then @foo(x - 1) else 0 in foo(0)",
                Type.TypeKind.Any,
                true,
            );
        });

        it(`WIP let x = () as function => () as number => 1 in x()()`, () => {
            expectSimpleExpressionType(
                "let x = () as function => () as number => 1 in x()()",
                Type.TypeKind.Number,
                false,
            );
        });
    });

    describe(`${Ast.NodeKind.UnaryExpression}`, () => {
        it(`+1`, () => {
            expectSimpleExpressionType(`+1`, Type.TypeKind.Number, false);
        });

        it(`-1`, () => {
            expectSimpleExpressionType(`-1`, Type.TypeKind.Number, false);
        });

        it(`not true`, () => {
            expectSimpleExpressionType(`not true`, Type.TypeKind.Logical, false);
        });

        it(`not false`, () => {
            expectSimpleExpressionType(`not false`, Type.TypeKind.Logical, false);
        });

        it(`not 1`, () => {
            expectSimpleExpressionType(`not 1`, Type.TypeKind.None, false);
        });

        it(`+true`, () => {
            expectSimpleExpressionType(`+true`, Type.TypeKind.None, false);
        });
    });
});

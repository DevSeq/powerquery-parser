// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Ast, NodeIdMap, ParserContext, ParserError } from "..";
import { CommonError, Option } from "../../common";
import { LexerSnapshot, Token, TokenKind } from "../../lexer";
import { IParserState } from "./IParserState";

import * as Localization from "../../localization/error";

export interface FastStateBackup {
    readonly tokenIndex: number;
    readonly contextStateIdCounter: number;
    readonly maybeContextNodeId: Option<number>;
}

// ---------------------------
// ---------- State ----------
// ---------------------------

export function newState(lexerSnapshot: LexerSnapshot): IParserState {
    const maybeCurrentToken: Option<Token> = lexerSnapshot.tokens[0];

    return {
        lexerSnapshot,
        tokenIndex: 0,
        maybeCurrentToken,
        maybeCurrentTokenKind: maybeCurrentToken !== undefined ? maybeCurrentToken.kind : undefined,
        contextState: ParserContext.newState(),
        maybeCurrentContextNode: undefined,
    };
}

export function deepCopy(state: IParserState): IParserState {
    return {
        lexerSnapshot: state.lexerSnapshot,
        tokenIndex: state.tokenIndex,
        maybeCurrentToken: state.maybeCurrentToken,
        maybeCurrentTokenKind: state.maybeCurrentTokenKind,
        contextState: ParserContext.deepCopy(state.contextState),
        maybeCurrentContextNode:
            state.maybeCurrentContextNode !== undefined ? { ...state.maybeCurrentContextNode } : undefined,
    };
}

export function applyState(originalState: IParserState, otherState: IParserState): void {
    originalState.tokenIndex = otherState.tokenIndex;
    originalState.maybeCurrentToken = otherState.maybeCurrentToken;
    originalState.maybeCurrentTokenKind = otherState.maybeCurrentTokenKind;

    originalState.contextState = otherState.contextState;
    originalState.maybeCurrentContextNode = otherState.maybeCurrentContextNode;
}

// Due to performance reasons the backup no longer can include a naive deep copy of the context state.
// Instead it's assumed that a backup is made immediately before a try/catch read block.
// This means the state begins in a parsing context and the backup will either be immediately consumed or dropped.
// Therefore we only care about the delta between before and after the try/catch block.
// Thanks to the invariants above and the fact the ids for nodes are an autoincremneting integer
// we can easily just drop all delete all context nodes past the id of when the backup was created.
export function fastStateBackup(state: IParserState): FastStateBackup {
    return {
        tokenIndex: state.tokenIndex,
        contextStateIdCounter: state.contextState.idCounter,
        maybeContextNodeId: state.maybeCurrentContextNode !== undefined ? state.maybeCurrentContextNode.id : undefined,
    };
}

// See state.fastSnapshot for more information.
export function applyFastStateBackup(state: IParserState, backup: FastStateBackup): void {
    state.tokenIndex = backup.tokenIndex;
    state.maybeCurrentToken = state.lexerSnapshot.tokens[state.tokenIndex];
    state.maybeCurrentTokenKind = state.maybeCurrentToken !== undefined ? state.maybeCurrentToken.kind : undefined;

    const contextState: ParserContext.State = state.contextState;
    const backupIdCounter: number = backup.contextStateIdCounter;
    contextState.idCounter = backupIdCounter;

    const newNodeIds: number[] = [];
    for (const nodeId of contextState.nodeIdMapCollection.contextNodeById.keys()) {
        if (nodeId > backupIdCounter) {
            newNodeIds.push(nodeId);
        }
    }

    for (const nodeId of newNodeIds.sort().reverse()) {
        ParserContext.deleteContext(state.contextState, nodeId);
    }

    if (backup.maybeContextNodeId) {
        state.maybeCurrentContextNode = NodeIdMap.expectContextNode(
            state.contextState.nodeIdMapCollection.contextNodeById,
            backup.maybeContextNodeId,
        );
    } else {
        state.maybeCurrentContextNode = undefined;
    }
}

export function startContext(state: IParserState, nodeKind: Ast.NodeKind): void {
    const newContextNode: ParserContext.Node = ParserContext.startContext(
        state.contextState,
        nodeKind,
        state.tokenIndex,
        state.maybeCurrentToken,
        state.maybeCurrentContextNode,
    );
    state.maybeCurrentContextNode = newContextNode;
}

export function endContext(state: IParserState, astNode: Ast.TNode): void {
    if (state.maybeCurrentContextNode === undefined) {
        throw new CommonError.InvariantError(
            "maybeContextNode should be truthy, can't end a context if it doesn't exist.",
        );
    }

    const maybeParentOfContextNode: Option<ParserContext.Node> = ParserContext.endContext(
        state.contextState,
        state.maybeCurrentContextNode,
        astNode,
    );
    state.maybeCurrentContextNode = maybeParentOfContextNode;
}

export function deleteContext(state: IParserState, maybeNodeId: Option<number>): void {
    let nodeId: number;
    if (maybeNodeId === undefined) {
        if (state.maybeCurrentContextNode === undefined) {
            throw new CommonError.InvariantError(
                "maybeContextNode should be truthy, can't delete a context if it doesn't exist.",
            );
        } else {
            const currentContextNode: ParserContext.Node = state.maybeCurrentContextNode;
            nodeId = currentContextNode.id;
        }
    } else {
        nodeId = maybeNodeId;
    }

    state.maybeCurrentContextNode = ParserContext.deleteContext(state.contextState, nodeId);
}

export function incrementAttributeCounter(state: IParserState): void {
    if (state.maybeCurrentContextNode === undefined) {
        throw new CommonError.InvariantError(`maybeCurrentContextNode should be truthy`);
    }
    const currentContextNode: ParserContext.Node = state.maybeCurrentContextNode;
    currentContextNode.attributeCounter += 1;
}

// -------------------------
// ---------- IsX ----------
// -------------------------

export function isTokenKind(state: IParserState, tokenKind: TokenKind, tokenIndex: number): boolean {
    const maybeToken: Option<Token> = state.lexerSnapshot.tokens[tokenIndex];

    if (maybeToken) {
        return maybeToken.kind === tokenKind;
    } else {
        return false;
    }
}

export function isNextTokenKind(state: IParserState, tokenKind: TokenKind): boolean {
    return isTokenKind(state, tokenKind, state.tokenIndex + 1);
}

export function isOnTokenKind(
    state: IParserState,
    tokenKind: TokenKind,
    tokenIndex: number = state.tokenIndex,
): boolean {
    return isTokenKind(state, tokenKind, tokenIndex);
}

export function isOnIdentifierConstant(state: IParserState, identifierConstant: Ast.IdentifierConstant): boolean {
    if (isOnTokenKind(state, TokenKind.Identifier)) {
        const currentToken: Token = state.lexerSnapshot.tokens[state.tokenIndex];
        if (currentToken === undefined || currentToken.data === undefined) {
            const details: {} = { currentToken };
            throw new CommonError.InvariantError(`expected data on Token`, details);
        }

        const data: string = currentToken.data;
        return data === identifierConstant;
    } else {
        return false;
    }
}

export function isOnGeneralizedIdentifierToken(state: IParserState, tokenIndex: number = state.tokenIndex): boolean {
    const maybeToken: Option<Token> = state.lexerSnapshot.tokens[tokenIndex];
    if (maybeToken === undefined) {
        return false;
    }
    const tokenKind: TokenKind = maybeToken.kind;

    switch (tokenKind) {
        case TokenKind.Identifier:
        case TokenKind.KeywordAnd:
        case TokenKind.KeywordAs:
        case TokenKind.KeywordEach:
        case TokenKind.KeywordElse:
        case TokenKind.KeywordError:
        case TokenKind.KeywordFalse:
        case TokenKind.KeywordHashBinary:
        case TokenKind.KeywordHashDate:
        case TokenKind.KeywordHashDateTime:
        case TokenKind.KeywordHashDateTimeZone:
        case TokenKind.KeywordHashDuration:
        case TokenKind.KeywordHashInfinity:
        case TokenKind.KeywordHashNan:
        case TokenKind.KeywordHashSections:
        case TokenKind.KeywordHashShared:
        case TokenKind.KeywordHashTable:
        case TokenKind.KeywordHashTime:
        case TokenKind.KeywordIf:
        case TokenKind.KeywordIn:
        case TokenKind.KeywordIs:
        case TokenKind.KeywordLet:
        case TokenKind.KeywordMeta:
        case TokenKind.KeywordNot:
        case TokenKind.KeywordOr:
        case TokenKind.KeywordOtherwise:
        case TokenKind.KeywordSection:
        case TokenKind.KeywordShared:
        case TokenKind.KeywordThen:
        case TokenKind.KeywordTrue:
        case TokenKind.KeywordTry:
        case TokenKind.KeywordType:
            return true;

        default:
            return false;
    }
}

// -----------------------------
// ---------- Expects ----------
// -----------------------------

export function expectContextNodeMetadata(state: IParserState): ContextNodeMetadata {
    if (state.maybeCurrentContextNode === undefined) {
        throw new CommonError.InvariantError("maybeCurrentContextNode should be truthy");
    }
    const currentContextNode: ParserContext.Node = state.maybeCurrentContextNode;

    const maybeTokenStart: Option<Token> = currentContextNode.maybeTokenStart;
    if (maybeTokenStart === undefined) {
        throw new CommonError.InvariantError(`maybeTokenStart should be truthy`);
    }
    const tokenStart: Token = maybeTokenStart;

    // inclusive token index
    const tokenIndexEnd: number = state.tokenIndex - 1;
    const maybeTokenEnd: Option<Token> = state.lexerSnapshot.tokens[tokenIndexEnd];
    if (maybeTokenEnd === undefined) {
        throw new CommonError.InvariantError(`maybeTokenEnd should be truthy`);
    }
    const tokenEnd: Token = maybeTokenEnd;

    const tokenRange: Ast.TokenRange = {
        tokenIndexStart: currentContextNode.tokenIndexStart,
        tokenIndexEnd,
        positionStart: tokenStart.positionStart,
        positionEnd: tokenEnd.positionEnd,
    };

    const contextNode: ParserContext.Node = state.maybeCurrentContextNode;
    return {
        id: contextNode.id,
        maybeAttributeIndex: currentContextNode.maybeAttributeIndex,
        tokenRange,
    };
}

export function expectTokenAt(state: IParserState, tokenIndex: number): Token {
    const lexerSnapshot: LexerSnapshot = state.lexerSnapshot;
    const maybeToken: Option<Token> = lexerSnapshot.tokens[tokenIndex];

    if (maybeToken) {
        return maybeToken;
    } else {
        throw new CommonError.InvariantError(`this.tokens[${tokenIndex}] is falsey`);
    }
}

// -------------------------------
// ---------- Csv Tests ----------
// -------------------------------

// All of these tests assume you're in a given context and have just read a `,`.
// Eg. testCsvEndLetExpression assumes you're in a LetExpression context and have just read a `,`.

export function testCsvContinuationLetExpression(
    state: IParserState,
): Option<ParserError.ExpectedCsvContinuationError> {
    if (state.maybeCurrentTokenKind === TokenKind.KeywordIn) {
        return new ParserError.ExpectedCsvContinuationError(
            Localization.parserExpectedCsvContinuationLetExpression(),
            maybeCurrentTokenWithColumnNumber(state),
        );
    }

    return undefined;
}

export function testCsvContinuationDanglingComma(
    state: IParserState,
    tokenKind: TokenKind,
): Option<ParserError.ExpectedCsvContinuationError> {
    if (state.maybeCurrentTokenKind === tokenKind) {
        return new ParserError.ExpectedCsvContinuationError(
            Localization.parserExpectedCsvContinuationDanglingComma(),
            maybeCurrentTokenWithColumnNumber(state),
        );
    } else {
        return undefined;
    }
}

// ---------------------------
// ---------- Tests ----------
// ---------------------------

export function testIsOnTokenKind(
    state: IParserState,
    expectedTokenKind: TokenKind,
): Option<ParserError.ExpectedTokenKindError> {
    if (expectedTokenKind !== state.maybeCurrentTokenKind) {
        const maybeTokenWithColumnNumber: Option<ParserError.TokenWithColumnNumber> =
            state.maybeCurrentToken !== undefined
                ? {
                      token: state.maybeCurrentToken,
                      columnNumber: state.lexerSnapshot.columnNumberStartFrom(state.maybeCurrentToken),
                  }
                : undefined;
        return new ParserError.ExpectedTokenKindError(expectedTokenKind, maybeTokenWithColumnNumber);
    } else {
        return undefined;
    }
}

export function testIsOnAnyTokenKind(
    state: IParserState,
    expectedAnyTokenKind: ReadonlyArray<TokenKind>,
): Option<ParserError.ExpectedAnyTokenKindError> {
    const isError: boolean =
        state.maybeCurrentTokenKind === undefined || expectedAnyTokenKind.indexOf(state.maybeCurrentTokenKind) === -1;

    if (isError) {
        const maybeTokenWithColumnNumber: Option<ParserError.TokenWithColumnNumber> = maybeCurrentTokenWithColumnNumber(
            state,
        );
        return new ParserError.ExpectedAnyTokenKindError(expectedAnyTokenKind, maybeTokenWithColumnNumber);
    } else {
        return undefined;
    }
}

export function testNoMoreTokens(state: IParserState): Option<ParserError.UnusedTokensRemainError> {
    if (state.tokenIndex !== state.lexerSnapshot.tokens.length) {
        const token: Token = expectTokenAt(state, state.tokenIndex);
        return new ParserError.UnusedTokensRemainError(token, state.lexerSnapshot.graphemePositionStartFrom(token));
    } else {
        return undefined;
    }
}

export function unterminatedParenthesesError(state: IParserState): ParserError.UnterminatedParenthesesError {
    const token: Token = expectTokenAt(state, state.tokenIndex);
    return new ParserError.UnterminatedParenthesesError(token, state.lexerSnapshot.graphemePositionStartFrom(token));
}

export function unterminatedBracketError(state: IParserState): ParserError.UnterminatedBracketError {
    const token: Token = expectTokenAt(state, state.tokenIndex);
    return new ParserError.UnterminatedBracketError(token, state.lexerSnapshot.graphemePositionStartFrom(token));
}

export function maybeCurrentTokenWithColumnNumber(state: IParserState): Option<ParserError.TokenWithColumnNumber> {
    const maybeCurrentToken: Option<Token> = state.maybeCurrentToken;
    if (maybeCurrentToken === undefined) {
        return undefined;
    }
    const currentToken: Token = maybeCurrentToken;

    return {
        token: currentToken,
        columnNumber: state.lexerSnapshot.columnNumberStartFrom(currentToken),
    };
}

interface ContextNodeMetadata {
    readonly id: number;
    readonly maybeAttributeIndex: Option<number>;
    readonly tokenRange: Ast.TokenRange;
}
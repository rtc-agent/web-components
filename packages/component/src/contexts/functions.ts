/**
 * Functions Context
 *
 * Provides the function registry state to child components.
 *
 * Consumed by: <rtc-function-tree>, <rtc-functions-layout>
 * Provided by: <rtc-agent> (root)
 */

import {createContext} from '@lit/context';
import type {FunctionDef, FunctionGroupDef} from '../types/skill.js';

/**
 * Functions context state
 */
export interface FunctionsState {
    /** All registered function definitions */
    functions: FunctionDef[];
    /** All registered group definitions */
    groups: FunctionGroupDef[];
}

/**
 * Functions context actions
 */
export interface FunctionsActions {
    /** Refresh the function list from the registry */
    refresh: () => void;
}

/**
 * Functions context value
 */
export interface FunctionsContextValue {
    state: FunctionsState;
    actions: FunctionsActions;
}

/**
 * Default state
 */
export const DEFAULT_FUNCTIONS_STATE: FunctionsState = {
    functions: [],
    groups: [],
};

/**
 * Functions context key
 */
export const FunctionsContext = createContext<FunctionsContextValue>(Symbol('functions-context'));

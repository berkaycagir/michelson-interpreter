'use strict';
/* jshint esversion: 11 */
/* jshint node: true */
// const { unstable } = require("jshint/src/options");
const assert = require('assert').strict;
const { serialize, deserialize } = require('@ungap/structured-clone');
const { Data, Delta, State, Step } = require('./types.cjs');
const base58check = require('base58check');
const keccak256 = require('keccak256');
const sha256 = require('js-sha256').sha256;
const sha3_256 = require('js-sha3').sha3_256;
const sha512 = require('js-sha512').sha512;

function initialize(parameter, storage) {
    return new Data("pair",
                    [new Data(parameter.prim,
                              parameter.args || []),
                     new Data(storage.prim,
                              storage.args || [])]
                    );
}

// returns [null or >= 1 strings]
function getInstructionParameters(requirements, stack) {
    let flag = false;
    if (requirements[0]) {
        const reqSize = requirements[1].reduce((previousValue, currentValue) =>
                                       previousValue > currentValue.length ? previousValue
                                       : currentValue.length, 0);
        if (reqSize > stack.length) {
            throw ('not enough elements in the stack');
        }
        const reqElems = stack.slice(-reqSize).reverse();
        for (let i = 0; i < requirements[1].length; i++) {
            if (reqElems.slice(0, requirements[1][i].length).map(x => x.prim).every((e, index) => e === requirements[1][i][index])) {
                flag = true;
                return reqElems.slice(0, requirements[1][i].length);
            }
        }
        if (!flag) {
            throw ('stack elements and opcode req does not match');
        }
    } else if (requirements.length == 2 && requirements[1][0] === null) {
        return [null];
    } else {
        let reqSize = requirements[1].length;
        if (reqSize > stack.length) {
            throw ('not enough elements in the stack');
        }
        const reqElems = stack.slice(-reqSize).reverse();
        if (requirements[1].every(x => x.length > 0) && !requirements[1].every((x, i) => x == reqElems[i].prim)) {
            throw ('stack elements and opcode req does not match');
        }
        return reqElems;
    }
}
// returns [true/false, [>= 1 strings]... if true else >= 1 strings]
function getInstructionRequirements(instruction) {
    const requirements = [];
    switch(instruction) {
        case 'ABS':
        case 'EQ':
        case 'GE':
        case 'GT':
        case 'ISNAT':
        case 'LE':
        case 'LT':
        case 'NEQ':
            requirements.push(false, ['int']);
            break;
        case 'ADD':
            requirements.push(true, [['nat', 'nat'], ['nat', 'int'], ['int', 'nat'],
                              ['int', 'int'], ['timestamp', 'int'], ['int', 'timestamp'],
                              ['mutez', 'mutez'], ['bls12_381_g1', 'bls12_381_g1'],
                              ['bls12_381_g2', 'bls12_381_g2'], ['bls12_381_fr', 'bls12_381_fr']]);
            break;
        case 'ADDRESS':
            requirements.push(false, ['contract']);
            break;
        case 'AMOUNT':
        case 'APPLY': // TODO: how to figure out ty1, ty2 and ty3?
        case 'BALANCE':
        case 'CHAIN_ID':
        case 'COMPARE': // TODO: how to figure out that both types are comparable?
        case 'CONS': // TODO: how to figure out that the ty1 and type of list is the same?
        case 'CONTRACT': // TODO: how to figure out the type of contract & address?
        case 'CREATE_CONTRACT': // TODO
        case 'DIG':
        case 'DIP':
        case 'DROP':
        case 'DUG':
        case 'DUP':
        case 'EMPTY_BIG_MAP':
        case 'EMPTY_MAP':
        case 'EMPTY_SET':
        case 'FAILWITH': // TODO: actually FAILWITH takes any type that's packable, need to figure out
        case 'LAMBDA':
        case 'LEVEL':
        case 'NIL':
        case 'NONE':
        case 'NOW':
        case 'PUSH':
        case 'SAPLING_EMPTY_STATE':
        case 'SELF':
        case 'SELF_ADDRESS':
        case 'SENDER':
        case 'TOTAL_VOTING_POWER':
        case 'UNIT':
            requirements.push(false, [null]);
            break;
        case 'AND':
            requirements.push(true, [['bool', 'bool'], ['nat', 'nat'], ['int', 'nat']]);
            break;
        case 'BLAKE2B':
        case 'KECCAK':
        case 'SHA256':
        case 'SHA3':
        case 'SHA512':
            requirements.push(false, ['bytes']);
            break;
        case 'CAR':
        case 'CDR':
        case 'JOIN_TICKETS':
            requirements.push(false, ['pair']);
            break;
        case 'CHECK_SIGNATURE':
            requirements.push(false, ['key', 'signature', 'bytes']);
            break;
        case 'CONCAT':
            // TODO: how to figure out that the type of list is either string or bytes?
            requirements.push(true, [['string', 'string'], ['bytes', 'bytes'], ['list']]);
            break;
        case 'EDIV':
            requirements.push(true, [['nat', 'nat'], ['nat', 'int'], ['int', 'nat'],
                              ['int', 'int'], ['mutez', 'nat'], ['mutez', 'mutez']]);
            break;
        case 'EXEC':
            // TODO: how to determine ty1 and lambda's type match?
            requirements.push(false, ['', 'lambda']);
            break;
        case 'GET':
            requirements.push(true, [['', 'map'], ['', 'big_map']]);
            break;
        case 'GET_AND_UPDATE':
            requirements.push(true, [['', 'option', 'map'], ['', 'option', 'big_map']]);
            break;
        case 'HASH_KEY':
            requirements.push(false, ['key']);
            break;
        case 'IF':
        case 'LOOP':
            requirements.push(false, ['bool']);
            break;
        case 'IF_CONS':
        case 'PAIRING_CHECK':
            requirements.push(false, ['list']);
            break;
        case 'IF_LEFT':
        case 'LOOP_LEFT':
            requirements.push(false, ['or']);
            break;
        case 'IF_NONE':
        case 'SET_DELEGATE':
            requirements.push(false, ['option']);
            break;
        case 'IMPLICIT_ACCOUNT':
        case 'VOTING_POWER':
            requirements.push(false, ['key_hash']);
            break;
        case 'INT':
            requirements.push(true, [['nat'], ['bls12_381_fr']]);
            break;
        case 'ITER':
            requirements.push(true, [['list'], ['set'], ['map']]);
            break;
        case 'LSL':
        case 'LSR':
            requirements.push(false, ['nat', 'nat']);
            break;
        case 'MAP':
            requirements.push(true, [['list'], ['map']]);
            break;
        case 'MEM':
            requirements.push(true, [['', 'set'], ['', 'map'], ['', 'big_map']]);
            break;
        case 'MUL':
            requirements.push(true, [['nat', 'nat'], ['nat', 'int'], ['int', 'nat'],
                              ['int', 'int'], ['mutez', 'nat'], ['nat', 'mutez'],
                              ['bls12_381_g1', 'bls12_381_fr'], ['bls12_381_g2', 'bls12_381_fr'],
                              ['bls12_381_fr', 'bls12_381_fr'], ['nat', 'bls12_381_fr'],
                              ['int', 'bls12_381_fr'], ['bls12_381_fr', 'nat'], ['bls12_381_fr', 'int']]);
            break;
        case 'NEG':
            requirements.push(true, [['nat'], ['int'], ['bls12_381_g1'], ['bls12_381_g2'], ['bls12_381_fr']]);
            break;
        case 'NEVER':
            requirements.push(false, ['never']);
            break;
        case 'NOT':
            requirements.push(true, [['bool'], ['nat'], ['int']]);
            break;
        case 'OR':
        case 'XOR':
            requirements.push(true, [['bool', 'bool'], ['nat', 'nat']]);
            break;
        case 'PACK': // TODO: how to determine ty1?
        case 'LEFT':
        case 'RIGHT':
        case 'SOME':
        case 'SOURCE':
            requirements.push(false, ['']);
            break;
        case 'PAIR': // TODO: how to determine ty1 & ty2? && there's a PAIR n version now that's not represented here
        case 'SWAP':
        case 'UNPAIR': // TODO: how to implement UNPAIR n version?
            requirements.push(false, ['', '']);
            break;
        case 'READ_TICKET':
            requirements.push(false, ['ticket']);
            break;
        case 'SAPLING_VERIFY_UPDATE':
            requirements.push(false, ['sapling_transaction', 'sapling_state']);
            break;
        case 'SIZE':
            requirements.push(true, [['set'], ['map'], ['list'], ['string'], ['bytes']]);
            break;
        case 'SLICE':
            requirements.push(true, [['nat', 'nat', 'string'], ['nat', 'nat', 'bytes']]);
            break;
        case 'SPLIT_TICKET':
            requirements.push(false, ['ticket', 'pair']);
            break;
        case 'SUB':
            requirements.push(true, [['nat', 'nat'], ['nat', 'int'], ['int', 'nat'],
                              ['int', 'int'], ['timestamp', 'int'],
                              ['timestamp', 'timestamp'], ['mutez', 'mutez']]);
            break;
        case 'TICKET':
            requirements.push(false, ['', 'nat']);
            break;
        case 'TRANSFER_TOKENS':
            requirements.push(false, ['', 'mutez', 'contract']);
            break;
        case 'UNPACK':
            requirements.push(false, ['', 'bytes']);
            break;
        case 'UPDATE':
            // TODO: how to implement UPDATE n version?
            requirements.push(true, [['', 'bool', 'set'], ['', 'option', 'map'],
                              ['', 'option', 'big_map']]);
            break;
        default:
            throw ('unknown instruction type '.concat(instruction));
    }
    return requirements;
}

function processInstruction(instruction, stack) {
    const parameters = getInstructionParameters(getInstructionRequirements(instruction.prim), stack);
    if (parameters.length != 1 || parameters[0] != null) {
        assert.deepEqual(stack.splice(-parameters.length).reverse(), parameters);
    }
    // We get the required elements of the stack with this.

    // We need to do the actual operation here. But how?
    const result = global["apply" + instruction.prim].call(null, instruction, parameters, stack);

    // We need to add whatever we removed or added from the stack into a Step and add it to steps.
    if (result != null) {
        if (!Array.isArray(result)) {
            stack.push(result);
        } else {
            result.reverse().forEach(e => stack.push(e));
        }
    }

    // We need to update our state(s)?
}

// ---------------------------

// instruction functions start
global.applyABS = (instruction, parameters, stack) => {
    return new Data("nat", [Math.abs(parseInt(parameters[0].value[0])).toString()]);
};
global.applyADD = (instruction, parameters, stack) => {
    switch (parameters[0].prim) {
        case "nat":
            return new Data(parameters[1].prim == "nat" ? "nat" : "int", [
                                (parseInt(parameters[0].value[0]) + 
                                parseInt(parameters[1].value[0])).toString()
                            ]);
        case "int":
            // Case when timestamp is a string hasn't been implemented
            return new Data(parameters[1].prim == "timestamp" ? "timestamp" : "int", [
                                (parseInt(parameters[0].value[0]) + 
                                 parseInt(parameters[1].value[0])).toString()
                            ]);
        case "timestamp":
            // Case when timestamp is a string hasn't been implemented
            return new Data("timestamp", [
                                (parseInt(parameters[0].value[0]) + 
                                 parseInt(parameters[1].value[0])).toString()
                            ]);
        case "mutez":
            return new Data("mutez", [
                                (parseInt(parameters[0].value[0]) + 
                                 parseInt(parameters[1].value[0])).toString()
                            ]);
        case "bls12_381_g1":
        case "bls12_381_g2":
        case "bls12_381_fr":
            // not implemented
            break;
    }
};
global.applyADDRESS = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("address", [
                        "some_address_value"
                    ]);
};
global.applyAMOUNT = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("mutez", ["0"]);
};
global.applyAND = (instruction, parameters, stack) => {
    switch (parameters[0].prim) {
        case "bool":
            const v = (JSON.parse(parameters[0].value[0].toLowerCase()) &&
                       JSON.parse(parameters[1].value[0].toLowerCase())).toString();
            return new Data("bool", [v[0].toUpperCase() + v.slice(1)]);
        case "nat":
        case "int":
            return new Data("nat", [(parseInt(parameters[0].value[0]) & parseInt(parameters[1].value[0])).toString()]);        
    }
};
global.applyAPPLY = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("lambda", [""]);
};
global.applyBALANCE = (instruction, parameters, stack) => {
    // Not implemented, should be taken from state?
    return new Data("mutez", ["0"]);
};
global.applyBLAKE2B = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("bytes", ["0x"]);
};
global.applyCAR = (instruction, parameters, stack) => {
    return parameters[0].value[0];
};
global.applyCDR = (instruction, parameters, stack) => {
    return parameters[0].value[1];
};
global.applyCHAIN_ID = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("chain_id", [""]);
};
global.applyCHECK_SIGNATURE = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("bool", ["False"]);
};
global.applyCOMPARE = (instruction, parameters, stack) => {
    // Not implemented for the moment
    return new Data("int", ["0"]);
};
global.applyCONCAT = (instruction, parameters, stack) => {
    if (parameters[0].prim != "list") {
        return new Data(parameters[0].prim == "string" ? "string" : "bytes", [
                            parameters[0].value[0] + parameters[1].value[0]
                        ]);
    } else {
        // Not implemented
    }
};
global.applyCONS = (instruction, parameters, stack) => {
    // Not implemented for the moment
    return new Data("list", []);
};
global.applyCONTRACT = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("option", []);
};
global.applyCREATE_CONTRACT = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("pair", []);
};
global.applyDIG = (instruction, parameters, stack) => {
    if (instruction.args[0].int != 0) {
        if (instruction.args[0].int > stack.length - 1) {
            throw('not enough elements in the stack');
        }
        arrayMoveMutable(stack, stack.length - 1 - instruction.args[0].int, stack.length - 1);
    }
    return null;
};
global.applyDIP = (instruction, parameters, stack) => {
    const n = instruction.args.length > 1 ? parseInt(instruction.args[0].int) : 1;
    if (n + 1 > stack.length) {
        throw('not enough elements in stack');
    }
    const p = stack.splice(stack.length - n);
    processInstruction(instruction.args[0], stack);
    p.forEach(e => stack.push(e));
};
global.applyDROP = (instruction, parameters, stack) => {
    const n = instruction.hasOwnProperty('args') ? parseInt(instruction.args[0].int) : 1;
    if (n > stack.length) {
        throw('not enough elements in stack');
    }
    if (n != 0) {
        stack.splice(stack.length - n);
    } 
    return null;
};
global.applyDUG = (instruction, parameters, stack) => {
    const n = parseInt(instruction.args[0].int);
    if (n == 0) {
        return null;
    }
    if (n >= stack.length) {
        throw('not enough elements in stack');
    }
    stack.splice(stack.length - 1 - n, 0, stack[stack.length - 1]);
    stack.pop();
    return null;
};
global.applyDUP = (instruction, parameters, stack) => {
    // Working for now but doesn't deep clone as Data
    const n = instruction.hasOwnProperty('args') ? parseInt(instruction.args[0].int) : 1;
    if (n === 0) {
        throw("non-allowed value for " + instruction.prim + ": " + instruction.args);
    }
    if (n > stack.length) {
        throw("not enough elements in the stack");
    }
    return deserialize(serialize(stack[stack.length - n]));
};
global.applyEDIV = (instruction, parameters, stack) => {
    const result = new Data("option", []);
    const z1 = parseInt(parameters[0].value[0]);
    const z2 = parseInt(parameters[1].value[0]);

    if (z2 === 0) {
        result.value.push("None");
        return result;
    } else {
        result.value.push("Some");
    }

    const q = Math.trunc(z1/z2);
    const r = z1 % z2;
    var t1 = "";
    var t2 = "";

    switch (parameters[0].prim) {
        case "nat":
            if (parameters[1].prim === "nat") {
                t1 = "nat";
                t2 = "nat";
            } else {
                t1 = "int";
                t2 = "nat";
            }
            break;
        case "int":
            t1 = "int";
            t2 = "nat";
            break;
        case "mutez":
            if (parameters[1].prim === "nat") {
                t1 = "mutez";
            } else {
                t1 = "nat";
            }
            t2 = "mutez";
            break;
    }
    result.value.push(new Data("pair", [new Data(t1, [q.toString()]), new Data(t2, [r.toString()])]));
    return result;
};
global.applyEMPTY_BIG_MAP = (instruction, parameters, stack) => {
    if (!new Data(instruction.args[0].prim).attributes.includes("C")) {
        throw("kty is not comparable");
    } else if (["operation", "big_map"].includes(instruction.args[1].prim)) {
        throw("vty is " + instruction.args[1].prim);
    }
    return new Data("big_map", [instruction.args[0].prim, instruction.args[1].prim]);
};
global.applyEMPTY_MAP = (instruction, parameters, stack) => {
    if (!new Data(instruction.args[0].prim).attributes.includes("C")) {
        throw("kty is not comparable");
    }
    return new Data("map", [instruction.args[0].prim, instruction.args[1].prim]);
};
global.applyEMPTY_SET = (instruction, parameters, stack) => {
    if (!new Data(instruction.args[0].prim).attributes.includes("C")) {
        throw("kty is not comparable");
    }
    return new Data("set", [instruction.args[0].prim]);
};
global.applyEQ = (instruction, parameters, stack) => {
    const result = new Data("bool", []);
    if (parseInt(parameters[0].value[0]) === 0) {
        result.value.push("True");
    } else {
        result.value.push("False");
    }
    return result;
};
global.applyEXEC = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("unit", []);
};
global.applyFAILWITH = (instruction, parameters, stack) => {
    if (!stack[stack.length - 1].attributes.includes("PA")) {
        throw("FAILWITH got non-packable top element");
    } else {
        throw("got FAILWITH, top element of the stack: " + stack[stack.length - 1].value);
    }
};
global.applyGE = (instruction, parameters, stack) => {
    const result = new Data("bool", []);
    if (parseInt(parameters[0].value[0]) >= 0) {
        result.value.push("True");
    } else {
        result.value.push("False");
    }
    return result;
};
global.applyGET = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("option", []);
};
global.applyGET_AND_UPDATE = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("option", []);
};
global.applyGT = (instruction, parameters, stack) => {
    const result = new Data("bool", []);
    if (parseInt(parameters[0].value[0]) > 0) {
        result.value.push("True");
    } else {
        result.value.push("False");
    }
    return result;
};
global.applyHASH_KEY = (instruction, parameters, stack) => {
    return new Data("key_hash", [base58check.encode(parameters[0].value[0])]);
};
global.applyIF = (instruction, parameters, stack) => {
    const v = JSON.parse(parameters[0].value[0].toLowerCase());
    if (v) {
        for (const i of instruction.args[0]) {
            processInstruction(i, stack);
        }
    } else {
        for (const i of instruction.args[1]) {
            processInstruction(i, stack);
        }
    }
    return null;
};
global.applyIF_CONS = (instruction, parameters, stack) => {
    // Not implemented yet
    return null;
};
global.applyIF_LEFT = (instruction, parameters, stack) => {
    // Not implemented yet
    return null;
};
global.applyIF_NONE = (instruction, parameters, stack) => {
    // Not implemented yet
    return null;
};
global.applyIMPLICIT_ACCOUNT = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("contract", [new Data("unit", [])]);
};
global.applyINT = (instruction, parameters, stack) => {
    // Not implemented for bls12_381_fr
    return new Data("int", [parameters[0].prim === "bls12_381_fr" ? 0 : parameters[0].value[0]]);
};
global.applyISNAT = (instruction, parameters, stack) => {
    const result = new Data("option", []);
    const v = parseInt(parameters[0].value[0]);
    if (v < 0) {
        result.value.push("None");
    } else {
        result.value.push("Some", new Data("nat", [parameters[0].value[0]]));
    }
    return result;
};
global.applyITER = (instruction, parameters, stack) => {
    // Not implemented
    return null;
};
global.applyJOIN_TICKETS = (instruction, parameters, stack) => {
    // Not implemented
    return null;
};
global.applyKECCAK = (instruction, parameters, stack) => {
    return new Data("bytes", [keccak256("0x" + parameters[0].value[0]).toString('hex')]);
};
global.applyLAMBDA = (instruction, parameters, stack) => {
    // Not implemented
    return null;
};
global.applyLE = (instruction, parameters, stack) => {
    const result = new Data("bool", []);
    if (parseInt(parameters[0].value[0]) <= 0) {
        result.value.push("True");
    } else {
        result.value.push("False");
    }
    return result;
};
global.applyLEFT = (instruction, parameters, stack) => {
    if (instruction.args[0].prim !== parameters[0].prim) {
        throw("given type and stack elements type doesn't match");
    } else {
        return new Data("or", ["Left", parameters[0]]);
    }
};
global.applyLEVEL = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('nat', ['0']);
};
global.applyLOOP = (instruction, parameters, stack) => {
    // Not implemented yet
    return null;
};
global.applyLOOP_LEFT = (instruction, parameters, stack) => {
    // Not implemented yet
    return null;
};
global.applyLSL = (instruction, parameters, stack) => {
    const f = parseInt(parameters[0].value[0]);
    const s = parseInt(parameters[1].value[0]);
    if (s > 256) {
        throw('s is larger than 256');
    }
    return new Data("nat", [(f << s).toString()]);
};
global.applyLSR = (instruction, parameters, stack) => {
    const f = parseInt(parameters[0].value[0]);
    const s = parseInt(parameters[1].value[0]);
    if (s > 256) {
        throw('s is larger than 256');
    }
    return new Data("nat", [(f >> s).toString()]);
};
global.applyLT = (instruction, parameters, stack) => {
    const result = new Data("bool", []);
    if (parseInt(parameters[0].value[0]) < 0) {
        result.value.push("True");
    } else {
        result.value.push("False");
    }
    return result;
};
global.applyMAP = (instruction, parameters, stack) => {
    // Not implemented yet
    return null;
};
global.applyMEM = (instruction, parameters, stack) => {
    // Not implemented yet
    return null;
};
global.applyMUL = (instruction, parameters, stack) => {
    const z1 = parseInt(parameters[0].value[0]);
    const z2 = parseInt(parameters[1].value[0]);
    var t = "";

    switch (parameters[0].prim) {
        case "nat":
            if (["nat", "int", "mutez"].includes(parameters[1].prim)) {
                t = parameters[1].prim;
            } else {
                throw('MUL not implemented for BLS12_381 variables');
            }
            break;
        case "int":
            t = "int";
            break;
        case "mutez":
            t = "mutez";
            break;
        default:
            throw('MUL not implemented for BLS12_381 variables');
    }
    return new Data(t, [(z1 * z2).toString()]);
};
global.applyNEG = (instruction, parameters, stack) => {
    if (!["nat", "int"].includes(parameters[0].prim)) {
        throw('NEG not implemented for BLS12_381 variables');
    }
    return new Data("int", [(-parseInt(parameters[0].value[0])).toString()]);
};
global.applyNEQ = (instruction, parameters, stack) => {
    const result = new Data("bool", []);
    if (parseInt(parameters[0].value[0]) !== 0) {
        result.value.push("True");
    } else {
        result.value.push("False");
    }
    return result;
};
global.applyNIL = (instruction, parameters, stack) => {
    if (!instruction.hasOwnProperty('args')) {
        throw('type of list is not declared');
    }
    return new Data('list', [instruction.args[0].prim]);
};
global.applyNONE = (instruction, parameters, stack) => {
    if (!instruction.hasOwnProperty('args')) {
        throw('type of option is not declared');
    }
    return new Data('option', ["None"]);
};
global.applyNOT = (instruction, parameters, stack) => {
    switch(parameters[0].prim) {
        case 'int':
        case 'nat':
            return new Data("int", [(~parseInt(parameters[0].value[0])).toString()]);
        case 'bool':
            const v = (!JSON.parse(parameters[0].value[0].toLowerCase())).toString();
            return new Data("bool", [v[0].toUpperCase() + v.slice(1)]);
    }
};
global.applyNOW = (instruction, parameters, stack) => {
    return new Data('timestamp', [Date.now().toString()]);
};
global.applyOR = (instruction, parameters, stack) => {
    if (parameters[0].prim === 'bool') {
        const v = (JSON.parse(parameters[0].value[0].toLowerCase()) ||
                   JSON.parse(parameters[1].value[0].toLowerCase())).toString();
            return new Data("bool", [v[0].toUpperCase() + v.slice(1)]);
    } else {
        return new Data('nat', [((parseInt(parameters[0].value[0])) | (parseInt(parameters[1].value[0]))).toString()]);
    }
};
global.applyPACK = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('bytes', []);
};
global.applyPAIR = (instruction, parameters, stack) => {
    if (instruction.hasOwnProperty('args')) {
        throw("PAIR 'n' case hasn't been implemented");
    }
    return new Data('pair', [parameters[0], parameters[1]]);
};
global.applyPAIRING_CHECK = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('bool', ['False']);
};
global.applyPUSH = (instruction, parameters, stack) => {
    const value = instruction.args[1].int || instruction.args[1].string || instruction.args[1].bytes || instruction.args[1].prim;
    return new Data(instruction.args[0].prim, [value]);
};
global.applyREAD_TICKET = (instruction, parameters, stack) => {
    // Not implemented
    return [new Data('pair', []), new Data('ticket', [])];
};
global.applyRIGHT = (instruction, parameters, stack) => {
    if (instruction.args[0].prim !== parameters[0].prim) {
        throw("given type and stack elements type doesn't match");
    } else {
        return new Data("or", ["Right", parameters[0]]);
    }
};
global.applySAPLING_EMPTY_STATE = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('sapling_state', []);
};
global.applySAPLING_VERIFY_UPDATE = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('option', []);
};
global.applySELF = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("contract", []);
};
global.applySELF_ADDRESS = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("address", []);
};
global.applySENDER = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("address", []);
};
global.applySET_DELEGATE = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('operation', []);
};
global.applySHA256 = (instruction, parameters, stack) => {
    return new Data("bytes", [sha256(parameters[0].value[0]).toString('hex')]);
};
global.applySHA3 = (instruction, parameters, stack) => {
    return new Data("bytes", [sha3_256(parameters[0].value[0]).toString('hex')]);
};
global.applySHA512 = (instruction, parameters, stack) => {
    return new Data("bytes", [sha512(parameters[0].value[0]).toString('hex')]);
};
global.applySIZE = (instruction, parameters, stack) => {
    if (['list', 'set', 'map'].includes(parameters[0].prim)) {
        throw('SIZE not implemented for list, set, map');
    }
    return new Data('nat', [parameters[0].value[0].length.toString()]);
};
global.applySLICE = (instruction, parameters, stack) => {
    const offset = parseInt(parameters[0].value[0]);
    const len = parseInt(parameters[1].value[0]);
    const str = parameters[2].value[0];
    if (str.length == 0 || offset >= str.length || offset + len > str.length) {
        return new Data('option', ["None"]);
    } else if (offset < str.length && offset + len <= str.length) {
        return new Data('option', ['Some', new Data('string', [str.slice(offset, offset + len)])]);
    }
};
global.applySOME = (instruction, parameters, stack) => {
    if (!instruction.hasOwnProperty('args')) {
        throw('type of option is not declared');
    } else if (instruction.args[0].prim !== parameters[0].prim) {
        throw("stack value and option type doesn't match");
    }
    return new Data('option', ["Some", parameters[0]]);
};
global.applySOURCE = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("address", []);
};
global.applySPLIT_TICKET = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('option', ['Some', new Data('pair', [new Data('ticket', []), new Data('ticket', [])])]);
};
global.applySUB = (instruction, parameters, stack) => {
    if ([parameters[0].prim, parameters[1].prim].includes("timestamp") &&
        (/[a-z]/i.test(parameters[0].value[0]) || /[a-z]/i.test(parameters[1].value[0]))) {
        throw('SUB not implemented for timestamps in RFC3339 notation');
    }

    const z1 = parseInt(parameters[0].value[0]);
    const z2 = parseInt(parameters[1].value[0]);
    var t = "";

    switch (parameters[0].prim) {
        case "nat":
        case "int":
            t = "int";
            break;
        case "timestamp":
            if (parameters[1].prim === "int") {
                t = "timestamp";
            } else {
                t = "int";
            }
            break;
        case "mutez":
            t = "mutez";
            break;
    }
    return new Data(t, [(z1 - z2).toString()]);
};
global.applySWAP = (instruction, parameters, stack) => {
    return parameters.reverse();
};
global.applyTICKET = (instruction, parameters, stack) => {
    // Not tested
    return new Data("ticket", [parameters[0]]);
};
global.applyTOTAL_VOTING_POWER = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("nat", ["0"]);
};
global.applyTRANSFER_TOKENS = (instruction, parameters, stack) => {
    // Not implemented
    return new Data("operation", []);
};
global.applyUNIT = (instruction, parameters, stack) => {
    return new Data("unit", ["Unit"]);
};
global.applyUNPACK = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('option', ['None']);
};
global.applyUNPAIR = (instruction, parameters, stack) => {
    // Implemented but parser doesn't use it as it's been introduced in Edo
    if (instruction.hasOwnProperty('args')) {
        throw("UNPAIR 'n' case hasn't been implemented");
    }
    return [parameters[0].value[0], parameters[0].value[1]];
};
global.applyUPDATE = (instruction, parameters, stack) => {
    // Not implemented yet
    if (instruction.hasOwnProperty('args')) {
        throw("UPDATE 'n' case hasn't been implemented");
    }
    return parameters[2];
};
global.applyVOTING_POWER = (instruction, parameters, stack) => {
    // Not implemented
    return new Data('nat', ['0']);
};
global.applyXOR = (instruction, parameters, stack) => {
    if (parameters[0].prim === 'bool') {
        const v = (JSON.parse(parameters[0].value[0].toLowerCase()) !=
                   JSON.parse(parameters[1].value[0].toLowerCase())).toString();
        return new Data("bool", [v[0].toUpperCase() + v.slice(1)]);
    } else {
        return new Data('nat', [(parseInt(parameters[0].value[0]) ^ parseInt(parameters[1].value[0])).toString()]);
    }
};
// instruction functions end

// boilerplate instruction function start
global.apply = (instruction, parameters, stack) => {
    console.dir(instruction, { depth: null });
    console.dir(parameters, { depth: null });
};
// boilerplate instruction function end

// from https://github.com/sindresorhus/array-move, because somehow I couldn't import it
function arrayMoveMutable(array, fromIndex, toIndex) {
	const startIndex = fromIndex < 0 ? array.length + fromIndex : fromIndex;

	if (startIndex >= 0 && startIndex < array.length) {
		const endIndex = toIndex < 0 ? array.length + toIndex : toIndex;

		const [item] = array.splice(fromIndex, 1);
		array.splice(endIndex, 0, item);
	}
}
//
exports.initialize = initialize;
exports.processInstruction = processInstruction;
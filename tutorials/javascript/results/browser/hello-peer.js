(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

function typedArraySupport () {
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    this.length = 0
    this.parent = undefined
  }

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

// TODO: Legacy, not needed anymore. Remove in next major version.
Buffer._augment = function (arr) {
  arr.__proto__ = Buffer.prototype
  return arr
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  array.byteLength // this throws if `array` is not a valid ArrayBuffer

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(array)
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
} else {
  // pre-set for values that may exist in the future
  Buffer.prototype.length = undefined
  Buffer.prototype.parent = undefined
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(length)
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
// Buffer instances.
Buffer.prototype._isBuffer = true

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = this.subarray(start, end)
    newBuf.__proto__ = Buffer.prototype
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    )
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":3,"ieee754":4,"isarray":5}],3:[function(require,module,exports){
;(function (exports) {
  'use strict'

  var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

  var PLUS = '+'.charCodeAt(0)
  var SLASH = '/'.charCodeAt(0)
  var NUMBER = '0'.charCodeAt(0)
  var LOWER = 'a'.charCodeAt(0)
  var UPPER = 'A'.charCodeAt(0)
  var PLUS_URL_SAFE = '-'.charCodeAt(0)
  var SLASH_URL_SAFE = '_'.charCodeAt(0)

  function decode (elt) {
    var code = elt.charCodeAt(0)
    if (code === PLUS || code === PLUS_URL_SAFE) return 62 // '+'
    if (code === SLASH || code === SLASH_URL_SAFE) return 63 // '/'
    if (code < NUMBER) return -1 // no match
    if (code < NUMBER + 10) return code - NUMBER + 26 + 26
    if (code < UPPER + 26) return code - UPPER
    if (code < LOWER + 26) return code - LOWER + 26
  }

  function b64ToByteArray (b64) {
    var i, j, l, tmp, placeHolders, arr

    if (b64.length % 4 > 0) {
      throw new Error('Invalid string. Length must be a multiple of 4')
    }

    // the number of equal signs (place holders)
    // if there are two placeholders, than the two characters before it
    // represent one byte
    // if there is only one, then the three characters before it represent 2 bytes
    // this is just a cheap hack to not do indexOf twice
    var len = b64.length
    placeHolders = b64.charAt(len - 2) === '=' ? 2 : b64.charAt(len - 1) === '=' ? 1 : 0

    // base64 is 4/3 + up to two characters of the original data
    arr = new Arr(b64.length * 3 / 4 - placeHolders)

    // if there are placeholders, only get up to the last complete 4 chars
    l = placeHolders > 0 ? b64.length - 4 : b64.length

    var L = 0

    function push (v) {
      arr[L++] = v
    }

    for (i = 0, j = 0; i < l; i += 4, j += 3) {
      tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
      push((tmp & 0xFF0000) >> 16)
      push((tmp & 0xFF00) >> 8)
      push(tmp & 0xFF)
    }

    if (placeHolders === 2) {
      tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
      push(tmp & 0xFF)
    } else if (placeHolders === 1) {
      tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
      push((tmp >> 8) & 0xFF)
      push(tmp & 0xFF)
    }

    return arr
  }

  function uint8ToBase64 (uint8) {
    var i
    var extraBytes = uint8.length % 3 // if we have 1 byte left, pad 2 bytes
    var output = ''
    var temp, length

    function encode (num) {
      return lookup.charAt(num)
    }

    function tripletToBase64 (num) {
      return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
    }

    // go through the array every three bytes, we'll deal with trailing stuff later
    for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
      temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
      output += tripletToBase64(temp)
    }

    // pad the end with zeros, but make sure to not forget the extra bytes
    switch (extraBytes) {
      case 1:
        temp = uint8[uint8.length - 1]
        output += encode(temp >> 2)
        output += encode((temp << 4) & 0x3F)
        output += '=='
        break
      case 2:
        temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
        output += encode(temp >> 10)
        output += encode((temp >> 4) & 0x3F)
        output += encode((temp << 2) & 0x3F)
        output += '='
        break
      default:
        break
    }

    return output
  }

  exports.toByteArray = b64ToByteArray
  exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],4:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],5:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],6:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    args = Array.prototype.slice.call(arguments, 1);
    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else if (listeners) {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.prototype.listenerCount = function(type) {
  if (this._events) {
    var evlistener = this._events[type];

    if (isFunction(evlistener))
      return 1;
    else if (evlistener)
      return evlistener.length;
  }
  return 0;
};

EventEmitter.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],7:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],8:[function(require,module,exports){
/**
 * Determine if an object is Buffer
 *
 * Author:   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * License:  MIT
 *
 * `npm install is-buffer`
 */

module.exports = function (obj) {
  return !!(obj != null &&
    (obj._isBuffer || // For Safari 5-7 (missing Object.prototype.constructor)
      (obj.constructor &&
      typeof obj.constructor.isBuffer === 'function' &&
      obj.constructor.isBuffer(obj))
    ))
}

},{}],9:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],10:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))
},{"_process":11}],11:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],12:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":13}],13:[function(require,module,exports){
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

'use strict';

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


module.exports = Duplex;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/



/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

var keys = objectKeys(Writable.prototype);
for (var v = 0; v < keys.length; v++) {
  var method = keys[v];
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
}

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  processNextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

},{"./_stream_readable":15,"./_stream_writable":17,"core-util-is":18,"inherits":7,"process-nextick-args":19}],14:[function(require,module,exports){
// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

'use strict';

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":16,"core-util-is":18,"inherits":7}],15:[function(require,module,exports){
(function (process){
'use strict';

module.exports = Readable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/


/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events');

/*<replacement>*/
var EElistenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/



/*<replacement>*/
var Stream;
(function (){try{
  Stream = require('st' + 'ream');
}catch(_){}finally{
  if (!Stream)
    Stream = require('events').EventEmitter;
}}())
/*</replacement>*/

var Buffer = require('buffer').Buffer;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/



/*<replacement>*/
var debugUtil = require('util');
var debug;
if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/

var StringDecoder;

util.inherits(Readable, Stream);

var Duplex;
function ReadableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

var Duplex;
function Readable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options && typeof options.read === 'function')
    this._read = options.read;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (!state.objectMode && typeof chunk === 'string') {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

Readable.prototype.isPaused = function() {
  return this._readableState.flowing === false;
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      if (!addToFront)
        state.reading = false;

      // if we want the data now, just emit it.
      if (state.flowing && state.length === 0 && !state.sync) {
        stream.emit('data', chunk);
        stream.read(0);
      } else {
        // update the buffer info.
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);

        if (state.needReadable)
          emitReadable(stream);
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}


// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 8MB
var MAX_HWM = 0x800000;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (n === null || isNaN(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = computeNewHighWaterMark(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else {
      return state.length;
    }
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (typeof n !== 'number' || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended)
      endReadable(this);
    else
      emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0)
      endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0)
    endReadable(this);

  if (ret !== null)
    this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!(Buffer.isBuffer(chunk)) &&
      typeof chunk !== 'string' &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync)
      processNextTick(emitReadable_, stream);
    else
      emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    processNextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    processNextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  var cleanedUp = false;
  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    cleanedUp = true;

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain &&
        (!dest._writableState || dest._writableState.needDrain))
      ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      if (state.pipesCount === 1 &&
          state.pipes[0] === dest &&
          src.listenerCount('data') === 1 &&
          !cleanedUp) {
        debug('false write response, pause', src._readableState.awaitDrain);
        src._readableState.awaitDrain++;
      }
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EElistenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];


  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain)
      state.awaitDrain--;
    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        processNextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    processNextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading)
    stream.read(0);
}

Readable.prototype.pause = function() {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    debug('wrapped data');
    if (state.decoder)
      chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined))
      return;
    else if (!state.objectMode && (!chunk || !chunk.length))
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }; }(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};


// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else if (list.length === 1)
      ret = list[0];
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    processNextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))
},{"./_stream_duplex":13,"_process":11,"buffer":2,"core-util-is":18,"events":6,"inherits":7,"isarray":9,"process-nextick-args":19,"string_decoder/":26,"util":1}],16:[function(require,module,exports){
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

'use strict';

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined)
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function')
      this._transform = options.transform;

    if (typeof options.flush === 'function')
      this._flush = options.flush;
  }

  this.once('prefinish', function() {
    if (typeof this._flush === 'function')
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":13,"core-util-is":18,"inherits":7}],17:[function(require,module,exports){
// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

'use strict';

module.exports = Writable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/


/*<replacement>*/
var internalUtil = {
  deprecate: require('util-deprecate')
};
/*</replacement>*/



/*<replacement>*/
var Stream;
(function (){try{
  Stream = require('st' + 'ream');
}catch(_){}finally{
  if (!Stream)
    Stream = require('events').EventEmitter;
}}())
/*</replacement>*/

var Buffer = require('buffer').Buffer;

util.inherits(Writable, Stream);

function nop() {}

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

var Duplex;
function WritableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

WritableState.prototype.getBuffer = function writableStateGetBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

(function (){try {
Object.defineProperty(WritableState.prototype, 'buffer', {
  get: internalUtil.deprecate(function() {
    return this.getBuffer();
  }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' +
     'instead.')
});
}catch(_){}}());


var Duplex;
function Writable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function')
      this._write = options.write;

    if (typeof options.writev === 'function')
      this._writev = options.writev;
  }

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  processNextTick(cb, er);
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;

  if (!(Buffer.isBuffer(chunk)) &&
      typeof chunk !== 'string' &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    processNextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (typeof cb !== 'function')
    cb = nop;

  if (state.ended)
    writeAfterEnd(this, cb);
  else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function() {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function() {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing &&
        !state.corked &&
        !state.finished &&
        !state.bufferProcessing &&
        state.bufferedRequest)
      clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string')
    encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64',
'ucs2', 'ucs-2','utf16le', 'utf-16le', 'raw']
.indexOf((encoding + '').toLowerCase()) > -1))
    throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      typeof chunk === 'string') {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);

  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev)
    stream._writev(chunk, state.onwrite);
  else
    stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;
  if (sync)
    processNextTick(cb, er);
  else
    cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished &&
        !state.corked &&
        !state.bufferProcessing &&
        state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      processNextTick(afterWrite, stream, state, finished, cb);
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var buffer = [];
    var cbs = [];
    while (entry) {
      cbs.push(entry.callback);
      buffer.push(entry);
      entry = entry.next;
    }

    // count the one we are adding, as well.
    // TODO(isaacs) clean this up
    state.pendingcb++;
    state.lastBufferedRequest = null;
    doWrite(stream, state, true, state.length, buffer, '', function(err) {
      for (var i = 0; i < cbs.length; i++) {
        state.pendingcb--;
        cbs[i](err);
      }
    });

    // Clear buffer
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null)
      state.lastBufferedRequest = null;
  }
  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined)
    this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(state) {
  return (state.ending &&
          state.length === 0 &&
          state.bufferedRequest === null &&
          !state.finished &&
          !state.writing);
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else {
      prefinish(stream, state);
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      processNextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

},{"./_stream_duplex":13,"buffer":2,"core-util-is":18,"events":6,"inherits":7,"process-nextick-args":19,"util-deprecate":20}],18:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.

function isArray(arg) {
  if (Array.isArray) {
    return Array.isArray(arg);
  }
  return objectToString(arg) === '[object Array]';
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = Buffer.isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

}).call(this,{"isBuffer":require("../../../../insert-module-globals/node_modules/is-buffer/index.js")})
},{"../../../../insert-module-globals/node_modules/is-buffer/index.js":8}],19:[function(require,module,exports){
(function (process){
'use strict';

if (!process.version ||
    process.version.indexOf('v0.') === 0 ||
    process.version.indexOf('v1.') === 0 && process.version.indexOf('v1.8.') !== 0) {
  module.exports = nextTick;
} else {
  module.exports = process.nextTick;
}

function nextTick(fn) {
  var args = new Array(arguments.length - 1);
  var i = 0;
  while (i < args.length) {
    args[i++] = arguments[i];
  }
  process.nextTick(function afterTick() {
    fn.apply(null, args);
  });
}

}).call(this,require('_process'))
},{"_process":11}],20:[function(require,module,exports){
(function (global){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],21:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":14}],22:[function(require,module,exports){
var Stream = (function (){
  try {
    return require('st' + 'ream'); // hack to fix a circular dependency issue when used with browserify
  } catch(_){}
}());
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = Stream || exports;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":13,"./lib/_stream_passthrough.js":14,"./lib/_stream_readable.js":15,"./lib/_stream_transform.js":16,"./lib/_stream_writable.js":17}],23:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":16}],24:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":17}],25:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":6,"inherits":7,"readable-stream/duplex.js":12,"readable-stream/passthrough.js":21,"readable-stream/readable.js":22,"readable-stream/transform.js":23,"readable-stream/writable.js":24}],26:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":2}],27:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],28:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":27,"_process":11,"inherits":7}],29:[function(require,module,exports){
/*!
  * domready (c) Dustin Diaz 2014 - License MIT
  */
!function (name, definition) {

  if (typeof module != 'undefined') module.exports = definition()
  else if (typeof define == 'function' && typeof define.amd == 'object') define(definition)
  else this[name] = definition()

}('domready', function () {

  var fns = [], listener
    , doc = document
    , hack = doc.documentElement.doScroll
    , domContentLoaded = 'DOMContentLoaded'
    , loaded = (hack ? /^loaded|^c/ : /^loaded|^i|^c/).test(doc.readyState)


  if (!loaded)
  doc.addEventListener(domContentLoaded, listener = function () {
    doc.removeEventListener(domContentLoaded, listener)
    loaded = 1
    while (listener = fns.shift()) listener()
  })

  return function (fn) {
    loaded ? setTimeout(fn, 0) : fns.push(fn)
  }

});

},{}],30:[function(require,module,exports){
/*!
 * EventEmitter2
 * https://github.com/hij1nx/EventEmitter2
 *
 * Copyright (c) 2013 hij1nx
 * Licensed under the MIT license.
 */
;!function(undefined) {

  var isArray = Array.isArray ? Array.isArray : function _isArray(obj) {
    return Object.prototype.toString.call(obj) === "[object Array]";
  };
  var defaultMaxListeners = 10;

  function init() {
    this._events = {};
    if (this._conf) {
      configure.call(this, this._conf);
    }
  }

  function configure(conf) {
    if (conf) {

      this._conf = conf;

      conf.delimiter && (this.delimiter = conf.delimiter);
      conf.maxListeners && (this._events.maxListeners = conf.maxListeners);
      conf.wildcard && (this.wildcard = conf.wildcard);
      conf.newListener && (this.newListener = conf.newListener);

      if (this.wildcard) {
        this.listenerTree = {};
      }
    }
  }

  function EventEmitter(conf) {
    this._events = {};
    this.newListener = false;
    configure.call(this, conf);
  }

  //
  // Attention, function return type now is array, always !
  // It has zero elements if no any matches found and one or more
  // elements (leafs) if there are matches
  //
  function searchListenerTree(handlers, type, tree, i) {
    if (!tree) {
      return [];
    }
    var listeners=[], leaf, len, branch, xTree, xxTree, isolatedBranch, endReached,
        typeLength = type.length, currentType = type[i], nextType = type[i+1];
    if (i === typeLength && tree._listeners) {
      //
      // If at the end of the event(s) list and the tree has listeners
      // invoke those listeners.
      //
      if (typeof tree._listeners === 'function') {
        handlers && handlers.push(tree._listeners);
        return [tree];
      } else {
        for (leaf = 0, len = tree._listeners.length; leaf < len; leaf++) {
          handlers && handlers.push(tree._listeners[leaf]);
        }
        return [tree];
      }
    }

    if ((currentType === '*' || currentType === '**') || tree[currentType]) {
      //
      // If the event emitted is '*' at this part
      // or there is a concrete match at this patch
      //
      if (currentType === '*') {
        for (branch in tree) {
          if (branch !== '_listeners' && tree.hasOwnProperty(branch)) {
            listeners = listeners.concat(searchListenerTree(handlers, type, tree[branch], i+1));
          }
        }
        return listeners;
      } else if(currentType === '**') {
        endReached = (i+1 === typeLength || (i+2 === typeLength && nextType === '*'));
        if(endReached && tree._listeners) {
          // The next element has a _listeners, add it to the handlers.
          listeners = listeners.concat(searchListenerTree(handlers, type, tree, typeLength));
        }

        for (branch in tree) {
          if (branch !== '_listeners' && tree.hasOwnProperty(branch)) {
            if(branch === '*' || branch === '**') {
              if(tree[branch]._listeners && !endReached) {
                listeners = listeners.concat(searchListenerTree(handlers, type, tree[branch], typeLength));
              }
              listeners = listeners.concat(searchListenerTree(handlers, type, tree[branch], i));
            } else if(branch === nextType) {
              listeners = listeners.concat(searchListenerTree(handlers, type, tree[branch], i+2));
            } else {
              // No match on this one, shift into the tree but not in the type array.
              listeners = listeners.concat(searchListenerTree(handlers, type, tree[branch], i));
            }
          }
        }
        return listeners;
      }

      listeners = listeners.concat(searchListenerTree(handlers, type, tree[currentType], i+1));
    }

    xTree = tree['*'];
    if (xTree) {
      //
      // If the listener tree will allow any match for this part,
      // then recursively explore all branches of the tree
      //
      searchListenerTree(handlers, type, xTree, i+1);
    }

    xxTree = tree['**'];
    if(xxTree) {
      if(i < typeLength) {
        if(xxTree._listeners) {
          // If we have a listener on a '**', it will catch all, so add its handler.
          searchListenerTree(handlers, type, xxTree, typeLength);
        }

        // Build arrays of matching next branches and others.
        for(branch in xxTree) {
          if(branch !== '_listeners' && xxTree.hasOwnProperty(branch)) {
            if(branch === nextType) {
              // We know the next element will match, so jump twice.
              searchListenerTree(handlers, type, xxTree[branch], i+2);
            } else if(branch === currentType) {
              // Current node matches, move into the tree.
              searchListenerTree(handlers, type, xxTree[branch], i+1);
            } else {
              isolatedBranch = {};
              isolatedBranch[branch] = xxTree[branch];
              searchListenerTree(handlers, type, { '**': isolatedBranch }, i+1);
            }
          }
        }
      } else if(xxTree._listeners) {
        // We have reached the end and still on a '**'
        searchListenerTree(handlers, type, xxTree, typeLength);
      } else if(xxTree['*'] && xxTree['*']._listeners) {
        searchListenerTree(handlers, type, xxTree['*'], typeLength);
      }
    }

    return listeners;
  }

  function growListenerTree(type, listener) {

    type = typeof type === 'string' ? type.split(this.delimiter) : type.slice();

    //
    // Looks for two consecutive '**', if so, don't add the event at all.
    //
    for(var i = 0, len = type.length; i+1 < len; i++) {
      if(type[i] === '**' && type[i+1] === '**') {
        return;
      }
    }

    var tree = this.listenerTree;
    var name = type.shift();

    while (name) {

      if (!tree[name]) {
        tree[name] = {};
      }

      tree = tree[name];

      if (type.length === 0) {

        if (!tree._listeners) {
          tree._listeners = listener;
        }
        else if(typeof tree._listeners === 'function') {
          tree._listeners = [tree._listeners, listener];
        }
        else if (isArray(tree._listeners)) {

          tree._listeners.push(listener);

          if (!tree._listeners.warned) {

            var m = defaultMaxListeners;

            if (typeof this._events.maxListeners !== 'undefined') {
              m = this._events.maxListeners;
            }

            if (m > 0 && tree._listeners.length > m) {

              tree._listeners.warned = true;
              console.error('(node) warning: possible EventEmitter memory ' +
                            'leak detected. %d listeners added. ' +
                            'Use emitter.setMaxListeners() to increase limit.',
                            tree._listeners.length);
              console.trace();
            }
          }
        }
        return true;
      }
      name = type.shift();
    }
    return true;
  }

  // By default EventEmitters will print a warning if more than
  // 10 listeners are added to it. This is a useful default which
  // helps finding memory leaks.
  //
  // Obviously not all Emitters should be limited to 10. This function allows
  // that to be increased. Set to zero for unlimited.

  EventEmitter.prototype.delimiter = '.';

  EventEmitter.prototype.setMaxListeners = function(n) {
    this._events || init.call(this);
    this._events.maxListeners = n;
    if (!this._conf) this._conf = {};
    this._conf.maxListeners = n;
  };

  EventEmitter.prototype.event = '';

  EventEmitter.prototype.once = function(event, fn) {
    this.many(event, 1, fn);
    return this;
  };

  EventEmitter.prototype.many = function(event, ttl, fn) {
    var self = this;

    if (typeof fn !== 'function') {
      throw new Error('many only accepts instances of Function');
    }

    function listener() {
      if (--ttl === 0) {
        self.off(event, listener);
      }
      fn.apply(this, arguments);
    }

    listener._origin = fn;

    this.on(event, listener);

    return self;
  };

  EventEmitter.prototype.emit = function() {

    this._events || init.call(this);

    var type = arguments[0];

    if (type === 'newListener' && !this.newListener) {
      if (!this._events.newListener) { return false; }
    }

    // Loop through the *_all* functions and invoke them.
    if (this._all) {
      var l = arguments.length;
      var args = new Array(l - 1);
      for (var i = 1; i < l; i++) args[i - 1] = arguments[i];
      for (i = 0, l = this._all.length; i < l; i++) {
        this.event = type;
        this._all[i].apply(this, args);
      }
    }

    // If there is no 'error' event listener then throw.
    if (type === 'error') {

      if (!this._all &&
        !this._events.error &&
        !(this.wildcard && this.listenerTree.error)) {

        if (arguments[1] instanceof Error) {
          throw arguments[1]; // Unhandled 'error' event
        } else {
          throw new Error("Uncaught, unspecified 'error' event.");
        }
        return false;
      }
    }

    var handler;

    if(this.wildcard) {
      handler = [];
      var ns = typeof type === 'string' ? type.split(this.delimiter) : type.slice();
      searchListenerTree.call(this, handler, ns, this.listenerTree, 0);
    }
    else {
      handler = this._events[type];
    }

    if (typeof handler === 'function') {
      this.event = type;
      if (arguments.length === 1) {
        handler.call(this);
      }
      else if (arguments.length > 1)
        switch (arguments.length) {
          case 2:
            handler.call(this, arguments[1]);
            break;
          case 3:
            handler.call(this, arguments[1], arguments[2]);
            break;
          // slower
          default:
            var l = arguments.length;
            var args = new Array(l - 1);
            for (var i = 1; i < l; i++) args[i - 1] = arguments[i];
            handler.apply(this, args);
        }
      return true;
    }
    else if (handler) {
      var l = arguments.length;
      var args = new Array(l - 1);
      for (var i = 1; i < l; i++) args[i - 1] = arguments[i];

      var listeners = handler.slice();
      for (var i = 0, l = listeners.length; i < l; i++) {
        this.event = type;
        listeners[i].apply(this, args);
      }
      return (listeners.length > 0) || !!this._all;
    }
    else {
      return !!this._all;
    }

  };

  EventEmitter.prototype.on = function(type, listener) {

    if (typeof type === 'function') {
      this.onAny(type);
      return this;
    }

    if (typeof listener !== 'function') {
      throw new Error('on only accepts instances of Function');
    }
    this._events || init.call(this);

    // To avoid recursion in the case that type == "newListeners"! Before
    // adding it to the listeners, first emit "newListeners".
    this.emit('newListener', type, listener);

    if(this.wildcard) {
      growListenerTree.call(this, type, listener);
      return this;
    }

    if (!this._events[type]) {
      // Optimize the case of one listener. Don't need the extra array object.
      this._events[type] = listener;
    }
    else if(typeof this._events[type] === 'function') {
      // Adding the second element, need to change to array.
      this._events[type] = [this._events[type], listener];
    }
    else if (isArray(this._events[type])) {
      // If we've already got an array, just append.
      this._events[type].push(listener);

      // Check for listener leak
      if (!this._events[type].warned) {

        var m = defaultMaxListeners;

        if (typeof this._events.maxListeners !== 'undefined') {
          m = this._events.maxListeners;
        }

        if (m > 0 && this._events[type].length > m) {

          this._events[type].warned = true;
          console.error('(node) warning: possible EventEmitter memory ' +
                        'leak detected. %d listeners added. ' +
                        'Use emitter.setMaxListeners() to increase limit.',
                        this._events[type].length);
          console.trace();
        }
      }
    }
    return this;
  };

  EventEmitter.prototype.onAny = function(fn) {

    if (typeof fn !== 'function') {
      throw new Error('onAny only accepts instances of Function');
    }

    if(!this._all) {
      this._all = [];
    }

    // Add the function to the event listener collection.
    this._all.push(fn);
    return this;
  };

  EventEmitter.prototype.addListener = EventEmitter.prototype.on;

  EventEmitter.prototype.off = function(type, listener) {
    if (typeof listener !== 'function') {
      throw new Error('removeListener only takes instances of Function');
    }

    var handlers,leafs=[];

    if(this.wildcard) {
      var ns = typeof type === 'string' ? type.split(this.delimiter) : type.slice();
      leafs = searchListenerTree.call(this, null, ns, this.listenerTree, 0);
    }
    else {
      // does not use listeners(), so no side effect of creating _events[type]
      if (!this._events[type]) return this;
      handlers = this._events[type];
      leafs.push({_listeners:handlers});
    }

    for (var iLeaf=0; iLeaf<leafs.length; iLeaf++) {
      var leaf = leafs[iLeaf];
      handlers = leaf._listeners;
      if (isArray(handlers)) {

        var position = -1;

        for (var i = 0, length = handlers.length; i < length; i++) {
          if (handlers[i] === listener ||
            (handlers[i].listener && handlers[i].listener === listener) ||
            (handlers[i]._origin && handlers[i]._origin === listener)) {
            position = i;
            break;
          }
        }

        if (position < 0) {
          continue;
        }

        if(this.wildcard) {
          leaf._listeners.splice(position, 1);
        }
        else {
          this._events[type].splice(position, 1);
        }

        if (handlers.length === 0) {
          if(this.wildcard) {
            delete leaf._listeners;
          }
          else {
            delete this._events[type];
          }
        }
        return this;
      }
      else if (handlers === listener ||
        (handlers.listener && handlers.listener === listener) ||
        (handlers._origin && handlers._origin === listener)) {
        if(this.wildcard) {
          delete leaf._listeners;
        }
        else {
          delete this._events[type];
        }
      }
    }

    return this;
  };

  EventEmitter.prototype.offAny = function(fn) {
    var i = 0, l = 0, fns;
    if (fn && this._all && this._all.length > 0) {
      fns = this._all;
      for(i = 0, l = fns.length; i < l; i++) {
        if(fn === fns[i]) {
          fns.splice(i, 1);
          return this;
        }
      }
    } else {
      this._all = [];
    }
    return this;
  };

  EventEmitter.prototype.removeListener = EventEmitter.prototype.off;

  EventEmitter.prototype.removeAllListeners = function(type) {
    if (arguments.length === 0) {
      !this._events || init.call(this);
      return this;
    }

    if(this.wildcard) {
      var ns = typeof type === 'string' ? type.split(this.delimiter) : type.slice();
      var leafs = searchListenerTree.call(this, null, ns, this.listenerTree, 0);

      for (var iLeaf=0; iLeaf<leafs.length; iLeaf++) {
        var leaf = leafs[iLeaf];
        leaf._listeners = null;
      }
    }
    else {
      if (!this._events[type]) return this;
      this._events[type] = null;
    }
    return this;
  };

  EventEmitter.prototype.listeners = function(type) {
    if(this.wildcard) {
      var handlers = [];
      var ns = typeof type === 'string' ? type.split(this.delimiter) : type.slice();
      searchListenerTree.call(this, handlers, ns, this.listenerTree, 0);
      return handlers;
    }

    this._events || init.call(this);

    if (!this._events[type]) this._events[type] = [];
    if (!isArray(this._events[type])) {
      this._events[type] = [this._events[type]];
    }
    return this._events[type];
  };

  EventEmitter.prototype.listenersAny = function() {

    if(this._all) {
      return this._all;
    }
    else {
      return [];
    }

  };

  if (typeof define === 'function' && define.amd) {
     // AMD. Register as an anonymous module.
    define(function() {
      return EventEmitter;
    });
  } else if (typeof exports === 'object') {
    // CommonJS
    exports.EventEmitter2 = EventEmitter;
  }
  else {
    // Browser global.
    window.EventEmitter2 = EventEmitter;
  }
}();

},{}],31:[function(require,module,exports){
//
// format - printf-like string formatting for JavaScript
// github.com/samsonjs/format
// @_sjs
//
// Copyright 2010 - 2013 Sami Samhuri <sami@samhuri.net>
//
// MIT License
// http://sjs.mit-license.org
//

;(function() {

  //// Export the API
  var namespace;

  // CommonJS / Node module
  if (typeof module !== 'undefined') {
    namespace = module.exports = format;
  }

  // Browsers and other environments
  else {
    // Get the global object. Works in ES3, ES5, and ES5 strict mode.
    namespace = (function(){ return this || (1,eval)('this') }());
  }

  namespace.format = format;
  namespace.vsprintf = vsprintf;

  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    namespace.printf = printf;
  }

  function printf(/* ... */) {
    console.log(format.apply(null, arguments));
  }

  function vsprintf(fmt, replacements) {
    return format.apply(null, [fmt].concat(replacements));
  }

  function format(fmt) {
    var argIndex = 1 // skip initial format argument
      , args = [].slice.call(arguments)
      , i = 0
      , n = fmt.length
      , result = ''
      , c
      , escaped = false
      , arg
      , tmp
      , leadingZero = false
      , precision
      , nextArg = function() { return args[argIndex++]; }
      , slurpNumber = function() {
          var digits = '';
          while (/\d/.test(fmt[i])) {
            digits += fmt[i++];
            c = fmt[i];
          }
          return digits.length > 0 ? parseInt(digits) : null;
        }
      ;
    for (; i < n; ++i) {
      c = fmt[i];
      if (escaped) {
        escaped = false;
        if (c == '.') {
          leadingZero = false;
          c = fmt[++i];
        }
        else if (c == '0' && fmt[i + 1] == '.') {
          leadingZero = true;
          i += 2;
          c = fmt[i];
        }
        else {
          leadingZero = true;
        }
        precision = slurpNumber();
        switch (c) {
        case 'b': // number in binary
          result += parseInt(nextArg(), 10).toString(2);
          break;
        case 'c': // character
          arg = nextArg();
          if (typeof arg === 'string' || arg instanceof String)
            result += arg;
          else
            result += String.fromCharCode(parseInt(arg, 10));
          break;
        case 'd': // number in decimal
          result += parseInt(nextArg(), 10);
          break;
        case 'f': // floating point number
          tmp = String(parseFloat(nextArg()).toFixed(precision || 6));
          result += leadingZero ? tmp : tmp.replace(/^0/, '');
          break;
        case 'j': // JSON
          result += JSON.stringify(nextArg());
          break;
        case 'o': // number in octal
          result += '0' + parseInt(nextArg(), 10).toString(8);
          break;
        case 's': // string
          result += nextArg();
          break;
        case 'x': // lowercase hexadecimal
          result += '0x' + parseInt(nextArg(), 10).toString(16);
          break;
        case 'X': // uppercase hexadecimal
          result += '0x' + parseInt(nextArg(), 10).toString(16).toUpperCase();
          break;
        default:
          result += c;
          break;
        }
      } else if (c === '%') {
        escaped = true;
      } else {
        result += c;
      }
    }
    return result;
  }

}());

},{}],32:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],33:[function(require,module,exports){
module.exports = true;
},{}],34:[function(require,module,exports){
;(function () { // closure for web browsers

if (typeof module === 'object' && module.exports) {
  module.exports = LRUCache
} else {
  // just set the global for non-node platforms.
  this.LRUCache = LRUCache
}

function hOP (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function naiveLength () { return 1 }

function LRUCache (options) {
  if (!(this instanceof LRUCache))
    return new LRUCache(options)

  if (typeof options === 'number')
    options = { max: options }

  if (!options)
    options = {}

  this._max = options.max
  // Kind of weird to have a default max of Infinity, but oh well.
  if (!this._max || !(typeof this._max === "number") || this._max <= 0 )
    this._max = Infinity

  this._lengthCalculator = options.length || naiveLength
  if (typeof this._lengthCalculator !== "function")
    this._lengthCalculator = naiveLength

  this._allowStale = options.stale || false
  this._maxAge = options.maxAge || null
  this._dispose = options.dispose
  this.reset()
}

// resize the cache when the max changes.
Object.defineProperty(LRUCache.prototype, "max",
  { set : function (mL) {
      if (!mL || !(typeof mL === "number") || mL <= 0 ) mL = Infinity
      this._max = mL
      if (this._length > this._max) trim(this)
    }
  , get : function () { return this._max }
  , enumerable : true
  })

// resize the cache when the lengthCalculator changes.
Object.defineProperty(LRUCache.prototype, "lengthCalculator",
  { set : function (lC) {
      if (typeof lC !== "function") {
        this._lengthCalculator = naiveLength
        this._length = this._itemCount
        for (var key in this._cache) {
          this._cache[key].length = 1
        }
      } else {
        this._lengthCalculator = lC
        this._length = 0
        for (var key in this._cache) {
          this._cache[key].length = this._lengthCalculator(this._cache[key].value)
          this._length += this._cache[key].length
        }
      }

      if (this._length > this._max) trim(this)
    }
  , get : function () { return this._lengthCalculator }
  , enumerable : true
  })

Object.defineProperty(LRUCache.prototype, "length",
  { get : function () { return this._length }
  , enumerable : true
  })


Object.defineProperty(LRUCache.prototype, "itemCount",
  { get : function () { return this._itemCount }
  , enumerable : true
  })

LRUCache.prototype.forEach = function (fn, thisp) {
  thisp = thisp || this
  var i = 0;
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    i++
    var hit = this._lruList[k]
    if (this._maxAge && (Date.now() - hit.now > this._maxAge)) {
      del(this, hit)
      if (!this._allowStale) hit = undefined
    }
    if (hit) {
      fn.call(thisp, hit.value, hit.key, this)
    }
  }
}

LRUCache.prototype.keys = function () {
  var keys = new Array(this._itemCount)
  var i = 0
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    var hit = this._lruList[k]
    keys[i++] = hit.key
  }
  return keys
}

LRUCache.prototype.values = function () {
  var values = new Array(this._itemCount)
  var i = 0
  for (var k = this._mru - 1; k >= 0 && i < this._itemCount; k--) if (this._lruList[k]) {
    var hit = this._lruList[k]
    values[i++] = hit.value
  }
  return values
}

LRUCache.prototype.reset = function () {
  if (this._dispose && this._cache) {
    for (var k in this._cache) {
      this._dispose(k, this._cache[k].value)
    }
  }

  this._cache = Object.create(null) // hash of items by key
  this._lruList = Object.create(null) // list of items in order of use recency
  this._mru = 0 // most recently used
  this._lru = 0 // least recently used
  this._length = 0 // number of items in the list
  this._itemCount = 0
}

// Provided for debugging/dev purposes only. No promises whatsoever that
// this API stays stable.
LRUCache.prototype.dump = function () {
  return this._cache
}

LRUCache.prototype.dumpLru = function () {
  return this._lruList
}

LRUCache.prototype.set = function (key, value) {
  if (hOP(this._cache, key)) {
    // dispose of the old one before overwriting
    if (this._dispose) this._dispose(key, this._cache[key].value)
    if (this._maxAge) this._cache[key].now = Date.now()
    this._cache[key].value = value
    this.get(key)
    return true
  }

  var len = this._lengthCalculator(value)
  var age = this._maxAge ? Date.now() : 0
  var hit = new Entry(key, value, this._mru++, len, age)

  // oversized objects fall out of cache automatically.
  if (hit.length > this._max) {
    if (this._dispose) this._dispose(key, value)
    return false
  }

  this._length += hit.length
  this._lruList[hit.lu] = this._cache[key] = hit
  this._itemCount ++

  if (this._length > this._max) trim(this)
  return true
}

LRUCache.prototype.has = function (key) {
  if (!hOP(this._cache, key)) return false
  var hit = this._cache[key]
  if (this._maxAge && (Date.now() - hit.now > this._maxAge)) {
    return false
  }
  return true
}

LRUCache.prototype.get = function (key) {
  return get(this, key, true)
}

LRUCache.prototype.peek = function (key) {
  return get(this, key, false)
}

LRUCache.prototype.pop = function () {
  var hit = this._lruList[this._lru]
  del(this, hit)
  return hit || null
}

LRUCache.prototype.del = function (key) {
  del(this, this._cache[key])
}

function get (self, key, doUse) {
  var hit = self._cache[key]
  if (hit) {
    if (self._maxAge && (Date.now() - hit.now > self._maxAge)) {
      del(self, hit)
      if (!self._allowStale) hit = undefined
    } else {
      if (doUse) use(self, hit)
    }
    if (hit) hit = hit.value
  }
  return hit
}

function use (self, hit) {
  shiftLU(self, hit)
  hit.lu = self._mru ++
  if (self._maxAge) hit.now = Date.now()
  self._lruList[hit.lu] = hit
}

function trim (self) {
  while (self._lru < self._mru && self._length > self._max)
    del(self, self._lruList[self._lru])
}

function shiftLU (self, hit) {
  delete self._lruList[ hit.lu ]
  while (self._lru < self._mru && !self._lruList[self._lru]) self._lru ++
}

function del (self, hit) {
  if (hit) {
    if (self._dispose) self._dispose(hit.key, hit.value)
    self._length -= hit.length
    self._itemCount --
    delete self._cache[ hit.key ]
    shiftLU(self, hit)
  }
}

// classy, since V8 prefers predictable objects.
function Entry (key, value, lu, length, now) {
  this.key = key
  this.value = value
  this.lu = lu
  this.length = length
  this.now = now
}

})()

},{}],35:[function(require,module,exports){
module.exports = minimatch
minimatch.Minimatch = Minimatch

var path = { sep: '/' }
try {
  path = require('path')
} catch (er) {}

var GLOBSTAR = minimatch.GLOBSTAR = Minimatch.GLOBSTAR = {}
var expand = require('brace-expansion')

// any single thing other than /
// don't need to escape / when using new RegExp()
var qmark = '[^/]'

// * => any number of characters
var star = qmark + '*?'

// ** when dots are allowed.  Anything goes, except .. and .
// not (^ or / followed by one or two dots followed by $ or /),
// followed by anything, any number of times.
var twoStarDot = '(?:(?!(?:\\\/|^)(?:\\.{1,2})($|\\\/)).)*?'

// not a ^ or / followed by a dot,
// followed by anything, any number of times.
var twoStarNoDot = '(?:(?!(?:\\\/|^)\\.).)*?'

// characters that need to be escaped in RegExp.
var reSpecials = charSet('().*{}+?[]^$\\!')

// "abc" -> { a:true, b:true, c:true }
function charSet (s) {
  return s.split('').reduce(function (set, c) {
    set[c] = true
    return set
  }, {})
}

// normalizes slashes.
var slashSplit = /\/+/

minimatch.filter = filter
function filter (pattern, options) {
  options = options || {}
  return function (p, i, list) {
    return minimatch(p, pattern, options)
  }
}

function ext (a, b) {
  a = a || {}
  b = b || {}
  var t = {}
  Object.keys(b).forEach(function (k) {
    t[k] = b[k]
  })
  Object.keys(a).forEach(function (k) {
    t[k] = a[k]
  })
  return t
}

minimatch.defaults = function (def) {
  if (!def || !Object.keys(def).length) return minimatch

  var orig = minimatch

  var m = function minimatch (p, pattern, options) {
    return orig.minimatch(p, pattern, ext(def, options))
  }

  m.Minimatch = function Minimatch (pattern, options) {
    return new orig.Minimatch(pattern, ext(def, options))
  }

  return m
}

Minimatch.defaults = function (def) {
  if (!def || !Object.keys(def).length) return Minimatch
  return minimatch.defaults(def).Minimatch
}

function minimatch (p, pattern, options) {
  if (typeof pattern !== 'string') {
    throw new TypeError('glob pattern string required')
  }

  if (!options) options = {}

  // shortcut: comments match nothing.
  if (!options.nocomment && pattern.charAt(0) === '#') {
    return false
  }

  // "" only matches ""
  if (pattern.trim() === '') return p === ''

  return new Minimatch(pattern, options).match(p)
}

function Minimatch (pattern, options) {
  if (!(this instanceof Minimatch)) {
    return new Minimatch(pattern, options)
  }

  if (typeof pattern !== 'string') {
    throw new TypeError('glob pattern string required')
  }

  if (!options) options = {}
  pattern = pattern.trim()

  // windows support: need to use /, not \
  if (path.sep !== '/') {
    pattern = pattern.split(path.sep).join('/')
  }

  this.options = options
  this.set = []
  this.pattern = pattern
  this.regexp = null
  this.negate = false
  this.comment = false
  this.empty = false

  // make the set of regexps etc.
  this.make()
}

Minimatch.prototype.debug = function () {}

Minimatch.prototype.make = make
function make () {
  // don't do it more than once.
  if (this._made) return

  var pattern = this.pattern
  var options = this.options

  // empty patterns and comments match nothing.
  if (!options.nocomment && pattern.charAt(0) === '#') {
    this.comment = true
    return
  }
  if (!pattern) {
    this.empty = true
    return
  }

  // step 1: figure out negation, etc.
  this.parseNegate()

  // step 2: expand braces
  var set = this.globSet = this.braceExpand()

  if (options.debug) this.debug = console.error

  this.debug(this.pattern, set)

  // step 3: now we have a set, so turn each one into a series of path-portion
  // matching patterns.
  // These will be regexps, except in the case of "**", which is
  // set to the GLOBSTAR object for globstar behavior,
  // and will not contain any / characters
  set = this.globParts = set.map(function (s) {
    return s.split(slashSplit)
  })

  this.debug(this.pattern, set)

  // glob --> regexps
  set = set.map(function (s, si, set) {
    return s.map(this.parse, this)
  }, this)

  this.debug(this.pattern, set)

  // filter out everything that didn't compile properly.
  set = set.filter(function (s) {
    return s.indexOf(false) === -1
  })

  this.debug(this.pattern, set)

  this.set = set
}

Minimatch.prototype.parseNegate = parseNegate
function parseNegate () {
  var pattern = this.pattern
  var negate = false
  var options = this.options
  var negateOffset = 0

  if (options.nonegate) return

  for (var i = 0, l = pattern.length
    ; i < l && pattern.charAt(i) === '!'
    ; i++) {
    negate = !negate
    negateOffset++
  }

  if (negateOffset) this.pattern = pattern.substr(negateOffset)
  this.negate = negate
}

// Brace expansion:
// a{b,c}d -> abd acd
// a{b,}c -> abc ac
// a{0..3}d -> a0d a1d a2d a3d
// a{b,c{d,e}f}g -> abg acdfg acefg
// a{b,c}d{e,f}g -> abdeg acdeg abdeg abdfg
//
// Invalid sets are not expanded.
// a{2..}b -> a{2..}b
// a{b}c -> a{b}c
minimatch.braceExpand = function (pattern, options) {
  return braceExpand(pattern, options)
}

Minimatch.prototype.braceExpand = braceExpand

function braceExpand (pattern, options) {
  if (!options) {
    if (this instanceof Minimatch) {
      options = this.options
    } else {
      options = {}
    }
  }

  pattern = typeof pattern === 'undefined'
    ? this.pattern : pattern

  if (typeof pattern === 'undefined') {
    throw new Error('undefined pattern')
  }

  if (options.nobrace ||
    !pattern.match(/\{.*\}/)) {
    // shortcut. no need to expand.
    return [pattern]
  }

  return expand(pattern)
}

// parse a component of the expanded set.
// At this point, no pattern may contain "/" in it
// so we're going to return a 2d array, where each entry is the full
// pattern, split on '/', and then turned into a regular expression.
// A regexp is made at the end which joins each array with an
// escaped /, and another full one which joins each regexp with |.
//
// Following the lead of Bash 4.1, note that "**" only has special meaning
// when it is the *only* thing in a path portion.  Otherwise, any series
// of * is equivalent to a single *.  Globstar behavior is enabled by
// default, and can be disabled by setting options.noglobstar.
Minimatch.prototype.parse = parse
var SUBPARSE = {}
function parse (pattern, isSub) {
  var options = this.options

  // shortcuts
  if (!options.noglobstar && pattern === '**') return GLOBSTAR
  if (pattern === '') return ''

  var re = ''
  var hasMagic = !!options.nocase
  var escaping = false
  // ? => one single character
  var patternListStack = []
  var negativeLists = []
  var plType
  var stateChar
  var inClass = false
  var reClassStart = -1
  var classStart = -1
  // . and .. never match anything that doesn't start with .,
  // even when options.dot is set.
  var patternStart = pattern.charAt(0) === '.' ? '' // anything
  // not (start or / followed by . or .. followed by / or end)
  : options.dot ? '(?!(?:^|\\\/)\\.{1,2}(?:$|\\\/))'
  : '(?!\\.)'
  var self = this

  function clearStateChar () {
    if (stateChar) {
      // we had some state-tracking character
      // that wasn't consumed by this pass.
      switch (stateChar) {
        case '*':
          re += star
          hasMagic = true
        break
        case '?':
          re += qmark
          hasMagic = true
        break
        default:
          re += '\\' + stateChar
        break
      }
      self.debug('clearStateChar %j %j', stateChar, re)
      stateChar = false
    }
  }

  for (var i = 0, len = pattern.length, c
    ; (i < len) && (c = pattern.charAt(i))
    ; i++) {
    this.debug('%s\t%s %s %j', pattern, i, re, c)

    // skip over any that are escaped.
    if (escaping && reSpecials[c]) {
      re += '\\' + c
      escaping = false
      continue
    }

    switch (c) {
      case '/':
        // completely not allowed, even escaped.
        // Should already be path-split by now.
        return false

      case '\\':
        clearStateChar()
        escaping = true
      continue

      // the various stateChar values
      // for the "extglob" stuff.
      case '?':
      case '*':
      case '+':
      case '@':
      case '!':
        this.debug('%s\t%s %s %j <-- stateChar', pattern, i, re, c)

        // all of those are literals inside a class, except that
        // the glob [!a] means [^a] in regexp
        if (inClass) {
          this.debug('  in class')
          if (c === '!' && i === classStart + 1) c = '^'
          re += c
          continue
        }

        // if we already have a stateChar, then it means
        // that there was something like ** or +? in there.
        // Handle the stateChar, then proceed with this one.
        self.debug('call clearStateChar %j', stateChar)
        clearStateChar()
        stateChar = c
        // if extglob is disabled, then +(asdf|foo) isn't a thing.
        // just clear the statechar *now*, rather than even diving into
        // the patternList stuff.
        if (options.noext) clearStateChar()
      continue

      case '(':
        if (inClass) {
          re += '('
          continue
        }

        if (!stateChar) {
          re += '\\('
          continue
        }

        plType = stateChar
        patternListStack.push({
          type: plType,
          start: i - 1,
          reStart: re.length
        })
        // negation is (?:(?!js)[^/]*)
        re += stateChar === '!' ? '(?:(?!(?:' : '(?:'
        this.debug('plType %j %j', stateChar, re)
        stateChar = false
      continue

      case ')':
        if (inClass || !patternListStack.length) {
          re += '\\)'
          continue
        }

        clearStateChar()
        hasMagic = true
        re += ')'
        var pl = patternListStack.pop()
        plType = pl.type
        // negation is (?:(?!js)[^/]*)
        // The others are (?:<pattern>)<type>
        switch (plType) {
          case '!':
            negativeLists.push(pl)
            re += ')[^/]*?)'
            pl.reEnd = re.length
            break
          case '?':
          case '+':
          case '*':
            re += plType
            break
          case '@': break // the default anyway
        }
      continue

      case '|':
        if (inClass || !patternListStack.length || escaping) {
          re += '\\|'
          escaping = false
          continue
        }

        clearStateChar()
        re += '|'
      continue

      // these are mostly the same in regexp and glob
      case '[':
        // swallow any state-tracking char before the [
        clearStateChar()

        if (inClass) {
          re += '\\' + c
          continue
        }

        inClass = true
        classStart = i
        reClassStart = re.length
        re += c
      continue

      case ']':
        //  a right bracket shall lose its special
        //  meaning and represent itself in
        //  a bracket expression if it occurs
        //  first in the list.  -- POSIX.2 2.8.3.2
        if (i === classStart + 1 || !inClass) {
          re += '\\' + c
          escaping = false
          continue
        }

        // handle the case where we left a class open.
        // "[z-a]" is valid, equivalent to "\[z-a\]"
        if (inClass) {
          // split where the last [ was, make sure we don't have
          // an invalid re. if so, re-walk the contents of the
          // would-be class to re-translate any characters that
          // were passed through as-is
          // TODO: It would probably be faster to determine this
          // without a try/catch and a new RegExp, but it's tricky
          // to do safely.  For now, this is safe and works.
          var cs = pattern.substring(classStart + 1, i)
          try {
            RegExp('[' + cs + ']')
          } catch (er) {
            // not a valid class!
            var sp = this.parse(cs, SUBPARSE)
            re = re.substr(0, reClassStart) + '\\[' + sp[0] + '\\]'
            hasMagic = hasMagic || sp[1]
            inClass = false
            continue
          }
        }

        // finish up the class.
        hasMagic = true
        inClass = false
        re += c
      continue

      default:
        // swallow any state char that wasn't consumed
        clearStateChar()

        if (escaping) {
          // no need
          escaping = false
        } else if (reSpecials[c]
          && !(c === '^' && inClass)) {
          re += '\\'
        }

        re += c

    } // switch
  } // for

  // handle the case where we left a class open.
  // "[abc" is valid, equivalent to "\[abc"
  if (inClass) {
    // split where the last [ was, and escape it
    // this is a huge pita.  We now have to re-walk
    // the contents of the would-be class to re-translate
    // any characters that were passed through as-is
    cs = pattern.substr(classStart + 1)
    sp = this.parse(cs, SUBPARSE)
    re = re.substr(0, reClassStart) + '\\[' + sp[0]
    hasMagic = hasMagic || sp[1]
  }

  // handle the case where we had a +( thing at the *end*
  // of the pattern.
  // each pattern list stack adds 3 chars, and we need to go through
  // and escape any | chars that were passed through as-is for the regexp.
  // Go through and escape them, taking care not to double-escape any
  // | chars that were already escaped.
  for (pl = patternListStack.pop(); pl; pl = patternListStack.pop()) {
    var tail = re.slice(pl.reStart + 3)
    // maybe some even number of \, then maybe 1 \, followed by a |
    tail = tail.replace(/((?:\\{2})*)(\\?)\|/g, function (_, $1, $2) {
      if (!$2) {
        // the | isn't already escaped, so escape it.
        $2 = '\\'
      }

      // need to escape all those slashes *again*, without escaping the
      // one that we need for escaping the | character.  As it works out,
      // escaping an even number of slashes can be done by simply repeating
      // it exactly after itself.  That's why this trick works.
      //
      // I am sorry that you have to see this.
      return $1 + $1 + $2 + '|'
    })

    this.debug('tail=%j\n   %s', tail, tail)
    var t = pl.type === '*' ? star
      : pl.type === '?' ? qmark
      : '\\' + pl.type

    hasMagic = true
    re = re.slice(0, pl.reStart) + t + '\\(' + tail
  }

  // handle trailing things that only matter at the very end.
  clearStateChar()
  if (escaping) {
    // trailing \\
    re += '\\\\'
  }

  // only need to apply the nodot start if the re starts with
  // something that could conceivably capture a dot
  var addPatternStart = false
  switch (re.charAt(0)) {
    case '.':
    case '[':
    case '(': addPatternStart = true
  }

  // Hack to work around lack of negative lookbehind in JS
  // A pattern like: *.!(x).!(y|z) needs to ensure that a name
  // like 'a.xyz.yz' doesn't match.  So, the first negative
  // lookahead, has to look ALL the way ahead, to the end of
  // the pattern.
  for (var n = negativeLists.length - 1; n > -1; n--) {
    var nl = negativeLists[n]

    var nlBefore = re.slice(0, nl.reStart)
    var nlFirst = re.slice(nl.reStart, nl.reEnd - 8)
    var nlLast = re.slice(nl.reEnd - 8, nl.reEnd)
    var nlAfter = re.slice(nl.reEnd)

    nlLast += nlAfter

    // Handle nested stuff like *(*.js|!(*.json)), where open parens
    // mean that we should *not* include the ) in the bit that is considered
    // "after" the negated section.
    var openParensBefore = nlBefore.split('(').length - 1
    var cleanAfter = nlAfter
    for (i = 0; i < openParensBefore; i++) {
      cleanAfter = cleanAfter.replace(/\)[+*?]?/, '')
    }
    nlAfter = cleanAfter

    var dollar = ''
    if (nlAfter === '' && isSub !== SUBPARSE) {
      dollar = '$'
    }
    var newRe = nlBefore + nlFirst + nlAfter + dollar + nlLast
    re = newRe
  }

  // if the re is not "" at this point, then we need to make sure
  // it doesn't match against an empty path part.
  // Otherwise a/* will match a/, which it should not.
  if (re !== '' && hasMagic) {
    re = '(?=.)' + re
  }

  if (addPatternStart) {
    re = patternStart + re
  }

  // parsing just a piece of a larger pattern.
  if (isSub === SUBPARSE) {
    return [re, hasMagic]
  }

  // skip the regexp for non-magical patterns
  // unescape anything in it, though, so that it'll be
  // an exact match against a file etc.
  if (!hasMagic) {
    return globUnescape(pattern)
  }

  var flags = options.nocase ? 'i' : ''
  var regExp = new RegExp('^' + re + '$', flags)

  regExp._glob = pattern
  regExp._src = re

  return regExp
}

minimatch.makeRe = function (pattern, options) {
  return new Minimatch(pattern, options || {}).makeRe()
}

Minimatch.prototype.makeRe = makeRe
function makeRe () {
  if (this.regexp || this.regexp === false) return this.regexp

  // at this point, this.set is a 2d array of partial
  // pattern strings, or "**".
  //
  // It's better to use .match().  This function shouldn't
  // be used, really, but it's pretty convenient sometimes,
  // when you just want to work with a regex.
  var set = this.set

  if (!set.length) {
    this.regexp = false
    return this.regexp
  }
  var options = this.options

  var twoStar = options.noglobstar ? star
    : options.dot ? twoStarDot
    : twoStarNoDot
  var flags = options.nocase ? 'i' : ''

  var re = set.map(function (pattern) {
    return pattern.map(function (p) {
      return (p === GLOBSTAR) ? twoStar
      : (typeof p === 'string') ? regExpEscape(p)
      : p._src
    }).join('\\\/')
  }).join('|')

  // must match entire pattern
  // ending in a * or ** will make it less strict.
  re = '^(?:' + re + ')$'

  // can match anything, as long as it's not this.
  if (this.negate) re = '^(?!' + re + ').*$'

  try {
    this.regexp = new RegExp(re, flags)
  } catch (ex) {
    this.regexp = false
  }
  return this.regexp
}

minimatch.match = function (list, pattern, options) {
  options = options || {}
  var mm = new Minimatch(pattern, options)
  list = list.filter(function (f) {
    return mm.match(f)
  })
  if (mm.options.nonull && !list.length) {
    list.push(pattern)
  }
  return list
}

Minimatch.prototype.match = match
function match (f, partial) {
  this.debug('match', f, this.pattern)
  // short-circuit in the case of busted things.
  // comments, etc.
  if (this.comment) return false
  if (this.empty) return f === ''

  if (f === '/' && partial) return true

  var options = this.options

  // windows: need to use /, not \
  if (path.sep !== '/') {
    f = f.split(path.sep).join('/')
  }

  // treat the test path as a set of pathparts.
  f = f.split(slashSplit)
  this.debug(this.pattern, 'split', f)

  // just ONE of the pattern sets in this.set needs to match
  // in order for it to be valid.  If negating, then just one
  // match means that we have failed.
  // Either way, return on the first hit.

  var set = this.set
  this.debug(this.pattern, 'set', set)

  // Find the basename of the path by looking for the last non-empty segment
  var filename
  var i
  for (i = f.length - 1; i >= 0; i--) {
    filename = f[i]
    if (filename) break
  }

  for (i = 0; i < set.length; i++) {
    var pattern = set[i]
    var file = f
    if (options.matchBase && pattern.length === 1) {
      file = [filename]
    }
    var hit = this.matchOne(file, pattern, partial)
    if (hit) {
      if (options.flipNegate) return true
      return !this.negate
    }
  }

  // didn't get any hits.  this is success if it's a negative
  // pattern, failure otherwise.
  if (options.flipNegate) return false
  return this.negate
}

// set partial to true to test if, for example,
// "/a/b" matches the start of "/*/b/*/d"
// Partial means, if you run out of file before you run
// out of pattern, then that's fine, as long as all
// the parts match.
Minimatch.prototype.matchOne = function (file, pattern, partial) {
  var options = this.options

  this.debug('matchOne',
    { 'this': this, file: file, pattern: pattern })

  this.debug('matchOne', file.length, pattern.length)

  for (var fi = 0,
      pi = 0,
      fl = file.length,
      pl = pattern.length
      ; (fi < fl) && (pi < pl)
      ; fi++, pi++) {
    this.debug('matchOne loop')
    var p = pattern[pi]
    var f = file[fi]

    this.debug(pattern, p, f)

    // should be impossible.
    // some invalid regexp stuff in the set.
    if (p === false) return false

    if (p === GLOBSTAR) {
      this.debug('GLOBSTAR', [pattern, p, f])

      // "**"
      // a/**/b/**/c would match the following:
      // a/b/x/y/z/c
      // a/x/y/z/b/c
      // a/b/x/b/x/c
      // a/b/c
      // To do this, take the rest of the pattern after
      // the **, and see if it would match the file remainder.
      // If so, return success.
      // If not, the ** "swallows" a segment, and try again.
      // This is recursively awful.
      //
      // a/**/b/**/c matching a/b/x/y/z/c
      // - a matches a
      // - doublestar
      //   - matchOne(b/x/y/z/c, b/**/c)
      //     - b matches b
      //     - doublestar
      //       - matchOne(x/y/z/c, c) -> no
      //       - matchOne(y/z/c, c) -> no
      //       - matchOne(z/c, c) -> no
      //       - matchOne(c, c) yes, hit
      var fr = fi
      var pr = pi + 1
      if (pr === pl) {
        this.debug('** at the end')
        // a ** at the end will just swallow the rest.
        // We have found a match.
        // however, it will not swallow /.x, unless
        // options.dot is set.
        // . and .. are *never* matched by **, for explosively
        // exponential reasons.
        for (; fi < fl; fi++) {
          if (file[fi] === '.' || file[fi] === '..' ||
            (!options.dot && file[fi].charAt(0) === '.')) return false
        }
        return true
      }

      // ok, let's see if we can swallow whatever we can.
      while (fr < fl) {
        var swallowee = file[fr]

        this.debug('\nglobstar while', file, fr, pattern, pr, swallowee)

        // XXX remove this slice.  Just pass the start index.
        if (this.matchOne(file.slice(fr), pattern.slice(pr), partial)) {
          this.debug('globstar found match!', fr, fl, swallowee)
          // found a match.
          return true
        } else {
          // can't swallow "." or ".." ever.
          // can only swallow ".foo" when explicitly asked.
          if (swallowee === '.' || swallowee === '..' ||
            (!options.dot && swallowee.charAt(0) === '.')) {
            this.debug('dot detected!', file, fr, pattern, pr)
            break
          }

          // ** swallows a segment, and continue.
          this.debug('globstar swallow a segment, and continue')
          fr++
        }
      }

      // no match was found.
      // However, in partial mode, we can't say this is necessarily over.
      // If there's more *pattern* left, then
      if (partial) {
        // ran out of file
        this.debug('\n>>> no match, partial?', file, fr, pattern, pr)
        if (fr === fl) return true
      }
      return false
    }

    // something other than **
    // non-magic patterns just have to match exactly
    // patterns with magic have been turned into regexps.
    var hit
    if (typeof p === 'string') {
      if (options.nocase) {
        hit = f.toLowerCase() === p.toLowerCase()
      } else {
        hit = f === p
      }
      this.debug('string match', p, f, hit)
    } else {
      hit = f.match(p)
      this.debug('pattern match', p, f, hit)
    }

    if (!hit) return false
  }

  // Note: ending in / means that we'll get a final ""
  // at the end of the pattern.  This can only match a
  // corresponding "" at the end of the file.
  // If the file ends in /, then it can only match a
  // a pattern that ends in /, unless the pattern just
  // doesn't have any more for it. But, a/b/ should *not*
  // match "a/b/*", even though "" matches against the
  // [^/]*? pattern, except in partial mode, where it might
  // simply not be reached yet.
  // However, a/b/ should still satisfy a/*

  // now either we fell off the end of the pattern, or we're done.
  if (fi === fl && pi === pl) {
    // ran out of pattern and filename at the same time.
    // an exact hit!
    return true
  } else if (fi === fl) {
    // ran out of file, but still had pattern left.
    // this is ok if we're doing the match as part of
    // a glob fs traversal.
    return partial
  } else if (pi === pl) {
    // ran out of pattern, still have file left.
    // this is only acceptable if we're on the very last
    // empty segment of a file with a trailing slash.
    // a/* should match a/b/
    var emptyFileEnd = (fi === fl - 1) && (file[fi] === '')
    return emptyFileEnd
  }

  // should be unreachable.
  throw new Error('wtf?')
}

// replace stuff like \* with *
function globUnescape (s) {
  return s.replace(/\\(.)/g, '$1')
}

function regExpEscape (s) {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}

},{"brace-expansion":36,"path":10}],36:[function(require,module,exports){
var concatMap = require('concat-map');
var balanced = require('balanced-match');

module.exports = expandTop;

var escSlash = '\0SLASH'+Math.random()+'\0';
var escOpen = '\0OPEN'+Math.random()+'\0';
var escClose = '\0CLOSE'+Math.random()+'\0';
var escComma = '\0COMMA'+Math.random()+'\0';
var escPeriod = '\0PERIOD'+Math.random()+'\0';

function numeric(str) {
  return parseInt(str, 10) == str
    ? parseInt(str, 10)
    : str.charCodeAt(0);
}

function escapeBraces(str) {
  return str.split('\\\\').join(escSlash)
            .split('\\{').join(escOpen)
            .split('\\}').join(escClose)
            .split('\\,').join(escComma)
            .split('\\.').join(escPeriod);
}

function unescapeBraces(str) {
  return str.split(escSlash).join('\\')
            .split(escOpen).join('{')
            .split(escClose).join('}')
            .split(escComma).join(',')
            .split(escPeriod).join('.');
}


// Basically just str.split(","), but handling cases
// where we have nested braced sections, which should be
// treated as individual members, like {a,{b,c},d}
function parseCommaParts(str) {
  if (!str)
    return [''];

  var parts = [];
  var m = balanced('{', '}', str);

  if (!m)
    return str.split(',');

  var pre = m.pre;
  var body = m.body;
  var post = m.post;
  var p = pre.split(',');

  p[p.length-1] += '{' + body + '}';
  var postParts = parseCommaParts(post);
  if (post.length) {
    p[p.length-1] += postParts.shift();
    p.push.apply(p, postParts);
  }

  parts.push.apply(parts, p);

  return parts;
}

function expandTop(str) {
  if (!str)
    return [];

  return expand(escapeBraces(str), true).map(unescapeBraces);
}

function identity(e) {
  return e;
}

function embrace(str) {
  return '{' + str + '}';
}
function isPadded(el) {
  return /^-?0\d/.test(el);
}

function lte(i, y) {
  return i <= y;
}
function gte(i, y) {
  return i >= y;
}

function expand(str, isTop) {
  var expansions = [];

  var m = balanced('{', '}', str);
  if (!m || /\$$/.test(m.pre)) return [str];

  var isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
  var isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
  var isSequence = isNumericSequence || isAlphaSequence;
  var isOptions = /^(.*,)+(.+)?$/.test(m.body);
  if (!isSequence && !isOptions) {
    // {a},b}
    if (m.post.match(/,.*}/)) {
      str = m.pre + '{' + m.body + escClose + m.post;
      return expand(str);
    }
    return [str];
  }

  var n;
  if (isSequence) {
    n = m.body.split(/\.\./);
  } else {
    n = parseCommaParts(m.body);
    if (n.length === 1) {
      // x{{a,b}}y ==> x{a}y x{b}y
      n = expand(n[0], false).map(embrace);
      if (n.length === 1) {
        var post = m.post.length
          ? expand(m.post, false)
          : [''];
        return post.map(function(p) {
          return m.pre + n[0] + p;
        });
      }
    }
  }

  // at this point, n is the parts, and we know it's not a comma set
  // with a single entry.

  // no need to expand pre, since it is guaranteed to be free of brace-sets
  var pre = m.pre;
  var post = m.post.length
    ? expand(m.post, false)
    : [''];

  var N;

  if (isSequence) {
    var x = numeric(n[0]);
    var y = numeric(n[1]);
    var width = Math.max(n[0].length, n[1].length)
    var incr = n.length == 3
      ? Math.abs(numeric(n[2]))
      : 1;
    var test = lte;
    var reverse = y < x;
    if (reverse) {
      incr *= -1;
      test = gte;
    }
    var pad = n.some(isPadded);

    N = [];

    for (var i = x; test(i, y); i += incr) {
      var c;
      if (isAlphaSequence) {
        c = String.fromCharCode(i);
        if (c === '\\')
          c = '';
      } else {
        c = String(i);
        if (pad) {
          var need = width - c.length;
          if (need > 0) {
            var z = new Array(need + 1).join('0');
            if (i < 0)
              c = '-' + z + c.slice(1);
            else
              c = z + c;
          }
        }
      }
      N.push(c);
    }
  } else {
    N = concatMap(n, function(el) { return expand(el, false) });
  }

  for (var j = 0; j < N.length; j++) {
    for (var k = 0; k < post.length; k++) {
      var expansion = pre + N[j] + post[k];
      if (!isTop || isSequence || expansion)
        expansions.push(expansion);
    }
  }

  return expansions;
}


},{"balanced-match":37,"concat-map":38}],37:[function(require,module,exports){
module.exports = balanced;
function balanced(a, b, str) {
  var r = range(a, b, str);

  return r && {
    start: r[0],
    end: r[1],
    pre: str.slice(0, r[0]),
    body: str.slice(r[0] + a.length, r[1]),
    post: str.slice(r[1] + b.length)
  };
}

balanced.range = range;
function range(a, b, str) {
  var begs, beg, left, right, result;
  var ai = str.indexOf(a);
  var bi = str.indexOf(b, ai + 1);
  var i = ai;

  if (ai >= 0 && bi > 0) {
    begs = [];
    left = str.length;

    while (i < str.length && i >= 0 && ! result) {
      if (i == ai) {
        begs.push(i);
        ai = str.indexOf(a, i + 1);
      } else if (begs.length == 1) {
        result = [ begs.pop(), bi ];
      } else {
        beg = begs.pop();
        if (beg < left) {
          left = beg;
          right = bi;
        }

        bi = str.indexOf(b, i + 1);
      }

      i = ai < bi && ai >= 0 ? ai : bi;
    }

    if (begs.length) {
      result = [ left, right ];
    }
  }

  return result;
}

},{}],38:[function(require,module,exports){
module.exports = function (xs, fn) {
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        var x = fn(xs[i], i);
        if (isArray(x)) res.push.apply(res, x);
        else res.push(x);
    }
    return res;
};

var isArray = Array.isArray || function (xs) {
    return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],39:[function(require,module,exports){
(function (process,global,Buffer){
'use strict';

var crypto = global.crypto || global.msCrypto
if(crypto && crypto.getRandomValues) {
  module.exports = randomBytes;
} else {
  module.exports = oldBrowser;
}
function randomBytes(size, cb) {
  var bytes = new Buffer(size); //in browserify, this is an extended Uint8Array
    /* This will not work in older browsers.
     * See https://developer.mozilla.org/en-US/docs/Web/API/window.crypto.getRandomValues
     */

  crypto.getRandomValues(bytes);
  if (typeof cb === 'function') {
    return process.nextTick(function () {
      cb(null, bytes);
    });
  }
  return bytes;
}
function oldBrowser() {
  throw new Error(
      'secure random number generation not supported by this browser\n'+
      'use chrome, FireFox or Internet Explorer 11'
    )
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"_process":11,"buffer":2}],40:[function(require,module,exports){

/**
 * Module dependencies.
 */

var global = (function() { return this; })();

/**
 * WebSocket constructor.
 */

var WebSocket = global.WebSocket || global.MozWebSocket;

/**
 * Module exports.
 */

module.exports = WebSocket ? ws : null;

/**
 * WebSocket constructor.
 *
 * The third `opts` options object gets ignored in web browsers, since it's
 * non-standard, and throws a TypeError if passed to the constructor.
 * See: https://github.com/einaros/ws/issues/227
 *
 * @param {String} uri
 * @param {Array} protocols (optional)
 * @param {Object) opts (optional)
 * @api public
 */

function ws(uri, protocols, opts) {
  var instance;
  if (protocols) {
    instance = new WebSocket(uri, protocols);
  } else {
    instance = new WebSocket(uri);
  }
  return instance;
}

if (WebSocket) ws.prototype = WebSocket.prototype;

},{}],41:[function(require,module,exports){
module.exports = extend

var hasOwnProperty = Object.prototype.hasOwnProperty;

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
                target[key] = source[key]
            }
        }
    }

    return target
}

},{}],42:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Types of messages between web app and extension.
 * @private
 */

module.exports = {
  TO_EXTENSION: 'vanadiumMessageToExtension',
  TO_PAGE: 'vanadiumMessageToPage',
  EXTENSION_IS_READY: 'vanadiumExtensionIsReady',
  EXTENSION_READY: 'vanadiumExtensionReady'
};

},{}],43:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var EE = require('eventemitter2').EventEmitter2;
var inherits = require('inherits');

var types = require('./event-proxy-message-types');
var extnUtils = require('./extension-utils');
var errors = require('../verror/index');

var defaultTimeout = 5000; // ms

// ExtensionEventProxy sends messages to the extension, and listens for messages
// coming from the extension.
function ExtensionEventProxy(timeout){
  if (!(this instanceof ExtensionEventProxy)) {
    return new ExtensionEventProxy(timeout);
  }

  if (typeof timeout === 'undefined') {
    timeout = defaultTimeout;
  }

  EE.call(this);
  var proxy = this;
  this.onEvent = function(ev) {
    proxy.emit(ev.detail.type, ev.detail.body);
  };
  window.addEventListener(types.TO_PAGE, this.onEvent);

  this.waitingForExtension = true;

  // Queue of messages to send once we know the extension event proxy is
  // listening.
  this.queuedMessages = [];

  // Check to see if the extension is installed.
  extnUtils.isExtensionInstalled(function(err, isInstalled) {
    if (err) {
      proxy.emit('error', err);
    }

    // If not installed, emit ExtensionNotInstalledError.
    if (!isInstalled) {
      proxy.emit('error', new errors.ExtensionNotInstalledError());
      proxy._extensionNotInstalled = true;
      return;
    }

    // Otherwise, wait until the extension has loaded and is responding to
    // messages.
    proxy.waitForExtension(timeout);
  });

  // Echo any errors or crashes we receive to the console.
  this.on('error', function(err) {
    console.error('Error message received from content script:', err);
  });
  this.on('crash', function(err) {
    console.error('Crash message received from content script.');
    if (err) {
      console.error(err);
    }
  });
}

inherits(ExtensionEventProxy, EE);

ExtensionEventProxy.prototype.destroy = function() {
  this.removeAllListeners();
  window.removeEventListener(types.TO_PAGE, this.onEvent);
};

ExtensionEventProxy.prototype.send = function(type, body) {
  // If we are still waiting for the extension, queue messages to be sent later.
  if (this.waitingForExtension) {
    this.queuedMessages.push({
      type: type,
      body: body
    });
    return;
  }

  window.dispatchEvent(
    new window.CustomEvent(types.TO_EXTENSION, {
      detail: {
        type: type,
        body: body
      }
    })
  );
};

// Repeatedly ping the extension, and wait a specified time for it to respond.
// If we don't hear back, emit an error.
ExtensionEventProxy.prototype.waitForExtension = function(timeout) {
  this.waitInterval = setInterval(function() {
    window.dispatchEvent(new window.CustomEvent(types.EXTENSION_IS_READY));
  }, 200);

  var proxy = this;

  this.waitTimeout = setTimeout(function() {
    if (!proxy.waitingForExtension) {
      return;
    }
    proxy.waitingForExtension = false;

    clearInterval(proxy.waitInterval);

    var error = new Error('Timeout waiting for extension.');
    proxy.emit('error', error);
  }, timeout);

  // Once the extension is listening, clear the timeout and interval, and send
  // queued messages.
  window.addEventListener(types.EXTENSION_READY, function() {
    if (!proxy.waitingForExtension) {
      return;
    }
    proxy.waitingForExtension = false;
    clearInterval(proxy.waitInterval);
    clearTimeout(proxy.waitTimeout);

    proxy.queuedMessages.forEach(function(msg) {
      proxy.send(msg.type, msg.body);
    });
    proxy.queuedMessages = [];

    proxy.emit('connected');
  });
};

// Wrapper around 'send' method that will call callback with error and data when
// extension responds.
ExtensionEventProxy.prototype.sendRpc = function(type, data, cb) {
  if (this._extensionNotInstalled) {
    cb(new errors.ExtensionNotInstalledError());
    return;
  }

  function onSuccess(data) {
    removeListeners();
    cb(null, data);
  }

  // Handle rpc-specific errors.
  function onRpcError(data) {
    removeListeners();
    cb(objectToError(data.error));
  }

  // Handle errors and crashes, which can be triggered if the extension is not
  // running or if it crashes during initialization.
  function onError(err) {
    removeListeners();
    cb(objectToError(err));
  }

  var proxy = this;
  function removeListeners() {
    proxy.removeListener(type + ':success', onSuccess);
    proxy.removeListener(type + ':error', onRpcError);
    proxy.removeListener('crash', onError);
    proxy.removeListener('error', onError);
  }

  this.on(type + ':success', onSuccess);
  this.on(type + ':error', onRpcError);
  this.on('crash', onError);
  this.on('error', onError);

  // Send request.
  this.send(type, data);
};

// An error that gets sent via postMessage will be received as a plain Object.
// This function turns it back into an Error object.
function objectToError(obj) {
  if (obj instanceof Error) {
    return obj;
  }
  var err = new Error(obj.message);
  err.name = obj.name;
  err.stack = obj.stack;
  return err;
}

module.exports = new ExtensionEventProxy();
module.exports.ctor = ExtensionEventProxy;

},{"../verror/index":151,"./event-proxy-message-types":42,"./extension-utils":46,"eventemitter2":30,"inherits":32}],44:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var extensionId = 'jcaelnibllfoobpedofhlaobfcoknpap';
module.exports = {
  extensionDocsUrl: ('https://vanadium.github.io/tools/' +
                     'vanadium-chrome-extension.html'),
  extensionId: extensionId,
  extensionUrl: 'https://chrome.google.com/webstore/detail/' + extensionId
};

},{}],45:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var inherits = require('inherits');

var consts = require('./extension-consts');

module.exports = {
  ExtensionCrashError: ExtensionCrashError,
  ExtensionNotInstalledError: ExtensionNotInstalledError,
};

/**
 * @summary
 * ExtensionCrashError indicates that the Vanadium extension has crashed.
 * This is only available in browser environment and will not exist in NodeJS.
 * @name ExtensionCrashError
 * @constructor
 * @memberof module:vanadium.verror
 * @extends Error
 */
function ExtensionCrashError(message) {
  this.name = 'ExtensionCrashError';
  this.message = message || [
    'The Vanadium extension has crashed.  It is necessary to reload this page ',
    'for Vanadium to continue to to fully function.'
  ].join('');
}
inherits(ExtensionCrashError, Error);

/**
 * @summary
 * ExtensionNotInstalledError indicates that the Vanadium extension is not
 * installed.
 * @description
 * This is only available in browser environment and will not exist in NodeJS.
 * @name ExtensionNotInstalledError
 * @constructor
 * @memberof module:vanadium.verror
 * @extends Error
 */
function ExtensionNotInstalledError(message) {
  this.name = 'ExtensionNotInstalledError';
  this.message = message || [
    'Error connecting to the Vanadium Chrome Extension.  Please make ',
    'sure the extension is installed and enabled.  Download it here: ',
    consts.extensionUrl
  ].join('');
}
inherits(ExtensionNotInstalledError, Error);

},{"./extension-consts":44,"inherits":32}],46:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @summary Namespace extenstion defines Chrome extension related exports.
 * @description Namespace extenstion defines Chrome extension related exports.
 * This is only available in browser environment and will not exist in NodeJS.
 * @namespace
 * @name extension
 * @memberof module:vanadium
 */

var domready = require('domready');
var extend = require('xtend');

var Deferred = require('../lib/deferred');
var consts = require('./extension-consts');

module.exports = {
  isExtensionInstalled: isExtensionInstalled,
  promptUserToInstallExtension: promptUserToInstallExtension
};

/**
 * Checks if the Vanadium extension is installed or not.
 * @param cb (error, boolean) Optional callback
 * @return {Promise.<boolean>} Promise that will be resolved with a boolean or
 * rejected with an error if there is one.
 * @memberof module:vanadium.extension
 */
function isExtensionInstalled(cb) {
  var def = new Deferred(cb);

  var imgUrl = 'chrome-extension://' + consts.extensionId + '/images/1x1.png';

  var img = window.document.createElement('img');
  img.setAttribute('src', imgUrl);

  img.addEventListener('load', loadHandler);
  img.addEventListener('error', errorHandler);

  function errorHandler() {
    def.resolve(false);
    removeHandlers();
  }

  function loadHandler() {
    def.resolve(true);
    removeHandlers();
  }

  function removeHandlers() {
    img.removeEventListener('load', loadHandler);
    img.removeEventListener('error', errorHandler);
  }

  return def.promise;
}

/**
 * Prompts the user to install the extension and reloads the page when extension
 * is installed. Some styling attributes such as colors and font can be
 * specified via options.
 * @param {object} options Styling options for prompt.
 * @param {string} [options.linkColor=#00838F] Link color.
 * @param {string} [options.buttonColor=#00838F] Button color.
 * @param {string} [options.titleColor=#00838F] Title color.
 * @param {string} [options.fontSize=18px] Font size.
 * @param {string} [options.fontFamily='Roboto', sans-serif] Font family.
 * @param {string} [options.titleFontSize=24px] Font size for title text.
 * @memberof module:vanadium.extension
 */
function promptUserToInstallExtension(options) {
  var defaults = {
    linkColor: '#00838F',
    buttonColor: '#00838F',
    titleColor: '#00838F',
    fontSize: '18px',
    fontFamily: '\'Roboto\', sans-serif',
    titleFontSize: '24px'
  };
  options = extend(defaults, options);

  var POLLING_INTERVAL = 1 * 1000;
  domready(function() {
    renderPrompt();
    poll();

    // poll until extension gets installed
    function poll() {
      isExtensionInstalled().then(function(isInstalled) {
        if (isInstalled) {
          window.location.reload();
        } else {
          setTimeout(poll, POLLING_INTERVAL);
        }
      });
    }
  });

  function renderPrompt() {
    // Note: We are in some other apps DOM, we need to be careful. We should not
    // specify ids, class names or styles so we do not stump on anything.
    // This is why all styles are inlined with the elements.

    var container = renderContainer();
    var dialog = renderDialog();

    container.appendChild(dialog);
    window.document.body.appendChild(container);
  }

  function renderContainer() {
    var MAX_ZINDEX = 2147483647;
    var container = window.document.createElement('div');
    var style = [
      'display: flex',
      'position: fixed',
      'z-index:' + (MAX_ZINDEX - 1),
      'top: 0',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'padding: 10px',
      'background-color: rgba(0, 0, 0, 0.6)',
      'font-family: ' + options.fontFamily,
      'font-size: ' + options.fontSize,
      'color: rgba(0, 0, 0, 0.87)'
    ].join(' !important;');
    container.setAttribute('style', style);

    return container;
  }

  function renderDialog() {
    var title = renderTitle();
    var content = renderContent();

    var dialog = window.document.createElement('div');
    var style = [
      'display: inline-block',
      'box-sizing: border-box',
      'align-self: center',
      'word-break: break-word',
      'max-width: 800px',
      'min-width: 480px',
      'padding: 15px',
      'margin: auto',
      'background-color: #FFFFFF',
      'box-shadow: rgba(0,0,0,0.2) 5px 5px 10px 5px'
    ].join('!important;');
    dialog.setAttribute('style', style);
    dialog.setAttribute('role', 'dialog');
    dialog.appendChild(title);
    dialog.appendChild(content);
    return dialog;
  }

  function renderTitle() {
    var title = window.document.createElement('h1');
    var style = [
      'margin: 0 0 10px 0',
      'color : ' + options.titleColor,
      'font-size: ' + options.titleFontSize
    ].join('!important;');
    title.setAttribute('style', style);
    title.textContent = 'Chrome Vanadium Extension is required.';

    return title;
  }

  function renderContent() {
    var content = window.document.createElement('div');
    var text = window.document.createElement('div');
    text.textContent =
      'Support for web applications is a work-in-progress.\n' +
      'Vanadium web apps can only run in the Chrome desktop browser with the ' +
      'Vanadium Extension installed. ';

    var moreInfoLink = window.document.createElement('a');
    moreInfoLink.textContent = 'Learn more.';
    moreInfoLink.href = consts.extensionDocsUrl;
    moreInfoLink.target = '_blank';
    var linkStyle = [
      'color: ' + options.linkColor,
      'text-decoration: none'
    ].join(' !important;');
    moreInfoLink.setAttribute('style', linkStyle);
    text.appendChild(moreInfoLink);

    var button = window.document.createElement('a');
    button.textContent = 'Install Vanadium Extension';
    button.href = consts.extensionUrl;
    button.target = '_blank';
    var buttonStyle = [
      'display: inline-block',
      'float: right',
      'background-color: ' + options.buttonColor,
      'color: #FFFFFF',
      'text-decoration: none',
      'margin: 15px 0 0 0',
      'padding: 10px',
      'border-radius: 3px',
      'box-shadow: 1px 2px 7px 0 rgba(0,0,0,0.8)'
    ].join(' !important;');
    button.setAttribute('style', buttonStyle);
    content.appendChild(text);
    content.appendChild(button);
    return content;
  }
}

},{"../lib/deferred":69,"./extension-consts":44,"domready":29,"xtend":41}],47:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

module.exports = ContextKey;
var nextKey = 0;
/**
 * @summary A ContextKey can be used as a key in the value/withValue
 * methods of Context.
 * @description Modules that want to attach data to the context should
 * first construct a key, then use that key whenever they want to
 * store or retrieve their data from the context.
 * @constructor
 * @memberof module:vanadium.context
 */
function ContextKey() {
  if (!(this instanceof ContextKey)) {
    return new ContextKey();
  }
  this._key = nextKey;
  nextKey++;
}

},{}],48:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @summary Namespace context defines an interface to carry
 * data that crosses API boundaries.
 *
 * @description
 * <p>Namespace context defines an interface to carry data that
 * crosses API boundaries. The context carries deadlines and
 * cancellation as well as other arbitrary values.</p>
 *
 * <p>Application code receives contexts in two main ways:
 * <ol>
 * <li>The runtime returned from vanadium.init() has a getContext() method.
 * This context will generally be used for stand-alone client programs.
 *   <pre>
 *     vanadium.init(function(err, runtime) {
 *       var ctx = runtime.getContext();
 *       doSomething(ctx);
 *     });
 *   </pre>
 * </li>
 * <li>The first parameter to every Vanadium server method implementation
 * is a Context.
 *   <pre>
 *     var MyService = {
 *       method: function(ctx, serverCall) {
 *         doSomething(ctx);
 *       }
 *     }
 *   </pre>
 * </li>
 * </ol></p>
 *
 * <p>Once you have a context you can derive further contexts to
 * change settings.  For example to adjust a deadline you might do:
 * </p>
 * <pre>
 *    vanadium.init(function(err, runtime) {
 *      var ctx = runtime.getContext();
 *      // We'll use cacheCtx to lookup data in memcache
 *      // if it takes more than a second to get data from
 *      // memcache we should just skip the cache and perform
 *      // the slow operation.
 *      var cacheCtx = context.withTimeout(ctx, 1000);
 *      fetchDataFromMemcache(cachCtx, key, function(err) {
 *        if (err) {
 *          // Here we use the original ctx, not the derived cacheCtx
 *          // so we aren't constrained by the 1 second timeout.
 *          recomputeData(ctx);
 *        }
 *      });
 *    });
 * </pre>
 *
 * <p>Contexts form a tree where derived contexts are children of the
 * contexts from which they were derived.  Children inherit all the
 * properties of their parent except for the property being replaced
 * (the deadline in the example above).</p>
 *
 * <p>Contexts are extensible.  The value/withValue methods allow you to attach
 * new information to the context and extend its capabilities.
 * In the same way we derive new contexts via the 'With' family of functions
 * you can create functions to attach new data:</p>
 *
 * <pre>
 *    function Auth() {
 *      // Construct my Auth object.
 *    }
 *
 *    var authKey = vanadium.context.ContextKey();
 *
 *    function setAuth(parent, auth) {
 *      return parent.withValue(authKey, auth);
 *    }
 *
 *    function getAuth(ctx) {
 *        return ctx.value(authKey);
 *    }
 * </pre>
 *
 * Note that all keys are of type ContextKey to prevent collisions.
 * By keeping your key unexported you can control how and when the
 * attached data changes.  For example you can ensure that only data
 * of the correct type is attached.
 * @namespace
 * @name context
 * @memberof module:vanadium
 */

var Deferred = require('../lib/deferred');
var Promise = require('../lib/promise');
var inherits = require('inherits');
var vError = require('../gen-vdl/v.io/v23/verror');
var ContextKey = require('../context/context-key');
var BigInt = require('../vdl/big-int');

module.exports = {
  Context: Context,
  ContextKey: ContextKey,
};

var CanceledError;
/**
 * @summary A Context carries deadlines, cancellation and data across API
 * boundaries.
 * @description
 * Generally application code should not call this constructor to
 * create contexts.  Instead it should call
 * [runtime.getContext]{@link module:vanadium~Runtime#getContext} or
 * use the context supplied as the first argument to server method
 * implementations.
 * @constructor
 * @memberof module:vanadium.context
 */
function Context() {
  if (!(this instanceof Context)) {
    return new Context();
  }
}

/**
 * Returns the time at which this context will be automatically
 * canceled.  If no deadline has been set, null is returned.
 * @return {Date} The Date corresponding to the deadline.
 */
Context.prototype.deadline = function() {
  return null;
};


/**
 * Returns true if the context has exceeded its deadline,
 * been cancelled, or been finished.
 * @return {boolean} True if the context is done.
 */
Context.prototype.done = function() {
  return false;
};

/**
 * Frees resources associated with the context without generating an error.
 * Only applicable to context objects returned from withCancel(). It does
 * nothing for other contexts.
 */
Context.prototype.finish = function() {
  // Do nothing for most contexts.
};

/**
 * Can be used to cancel the context and generate a
 * {@link module:vanadium.verror.CanceledError}.
 * Only applicable to context objects returned from withCancel(). It does
 * nothing for other contexts.
 */
Context.prototype.cancel = function() {
  // Do nothing for most contexts.
};

/**
 * Returns a promise that will be resolved when the context exceeds
 * its deadline, is cancelled, or is finished.  Optionally you can
 * pass a callback that will be run when the promise is resolved.
 * @param {module:vanadium~voidCb} [cb] If provided, the function
 * will be called on completion.
 * @return {Promise} Promise to be called on completion.
 */
Context.prototype.waitUntilDone = function(callback) {
  // The root context can never be cancelled, and therefore we
  // throw away the context and return a promise that will never
  // be resolved.
  return new Promise(function(){});
};

/**
 * Returns the value corresponding to the given key.  The
 * [value]{@link module:vanadium.context.Context#value}/
 * [withValue]{@link module:vanadium.context.Context#withValue}
 * methods can be used to attach data to context that
 * will be carried across API boundaries.  You should use this only
 * for data that is relevant across multiple API boundaries and not
 * just to pass extra parameters to functions and methods.  The key
 * must be an instance of ContextKey.  This function will return null
 * if there is no value associated with the given key.
 * @param {module:vanadium.context.ContextKey} key A ContextKey to look up.
 * @return {*} The value associated with the key, or null.
 */
Context.prototype.value = function(key) {
  return null;
};

/**
 * Returns a new context derived from the current context but that
 * will return the given value when value(key) is called with the
 * given key.
 * @param {module:vanadium.context.ContextKey} key A key.
 * @param {*} value A value to associate with the key.
 * @return {module:vanadium.context.Context} A new derived context.
 */
Context.prototype.withValue = function(key, value) {
  return new ValueContext(this, key, value);
};

/**
 * Returns a new context derived from the current context but that can
 * be cancelled.  The returned context will have two additional
 * methods [cancel()]{@link module:vanadium.context.Context#cancel} which
 * can be used to cancel the context and
 * generate a {@link module:vanadium.verror.CanceledError} and
 * [finish()]{@link module:vanadium.context.Context#finish} which
 * frees resources associated with the context without generating an error.
 * @return {module:vanadium.context.Context} A new derived cancellable context.
 */
Context.prototype.withCancel = function() {
  return new CancelContext(this);
};

/**
 * Returns a new context derived from the current context but that
 * will be automatically cancelled after a given deadline.  The
 * returned context will have an additional method cancel() which can
 * be used to cancel the context early.
 * @param {Date} deadline A date object which specifies the deadline.
 * @return {module:vanadium.context.Context} A new derived cancellable context.
 */
Context.prototype.withDeadline = function(deadline) {
  return new DeadlineContext(this, deadline);
};

/**
 * Returns a new context derived from the current context but that
 * will be automatically cancelled after a given timeout.  The
 * returned context will have an additional method cancel() which can
 * be used to cancel the context early.
 * @param {number} timeout A timeout in milliseconds.
 * @return {module:vanadium.context.Context} A new derived cancellable context.
 */
Context.prototype.withTimeout = function(timeout) {
  var msTimeout = timeout;
  if (timeout instanceof BigInt) {
    msTimeout = timeout.toNativeNumberApprox();
  }
  return new DeadlineContext(this, Date.now() + msTimeout);
};


// ChildContext is a the base class for other context specializations.
// It defers all its calls to its parent.
function ChildContext(parent) {
  this._parent = parent;
  Context.call(this);
}
inherits(ChildContext, Context);

ChildContext.prototype.deadline = function() {
  return this._parent.deadline();
};
ChildContext.prototype.done = function() {
  return this._parent.done();
};
ChildContext.prototype.waitUntilDone = function(callback) {
  return this._parent.waitUntilDone(callback);
};
ChildContext.prototype.value = function(key) {
  return this._parent.value(key);
};
ChildContext.prototype.finish = function() {
  return this._parent.finish();
};
ChildContext.prototype.cancel = function() {
  return this._parent.cancel();
};

// ValueContext is a context that associates a single key with a
// single value.
function ValueContext(parent, key, value) {
  if (!(key instanceof ContextKey)) {
    throw new vError.BadArgError(
      this,
      'Attempting to set a value on a context, ' +
      'but the key is not of type ContextKey.');
  }

  this._key = key;
  this._value = value;
  ChildContext.call(this, parent);
}
inherits(ValueContext, ChildContext);

ValueContext.prototype.value = function(key) {
  if (!(key instanceof ContextKey)) {
    throw new vError.BadArgError(
      this,
      ['Attempting to look up a value on a context, ' +
      'but the key is not of type ContextKey.']);
  }
  if (key._key === this._key._key) {
    return this._value;
  }
  return this._parent.value(key);
};

// cancellableAncestor walks up the tree of parent contexts to find
// the nearest ancestor that is cancellable.
function cancellableAncestor(parent) {
  for (; parent instanceof ChildContext; parent = parent._parent) {
    if (parent instanceof CancelContext) {
      return parent;
    }
  }
  // If we've reached the root, there is no cancellable ancestor.
  return null;
}

// A CancelContext is a context which can be cancelled.
function CancelContext(parent) {
  this._id = CancelContext._nextID;
  CancelContext._nextID++;

  this._done = false;
  this._deferred = new Deferred();
  this._children = {};

  // We need to arrange to be cancelled when our parent is.
  var ca = cancellableAncestor(parent);
  if (ca) {
    ca._children[this._id] = this;
  }

  ChildContext.call(this, parent);
}
inherits(CancelContext, ChildContext);

CancelContext._nextID = 0;

CancelContext.prototype.done = function() {
  return this._done;
};

CancelContext.prototype._cancel = function(error) {
  this._done = true;
  if (error) {
    this._deferred.reject(error);
  } else {
    this._deferred.resolve();
  }
  for (var id in this._children) {
    if (this._children.hasOwnProperty(id)) {
      this._children[id]._cancel(error);
    }
  }
  this._children = {};
};

CancelContext.prototype.cancel = function() {
  var ca = cancellableAncestor(this._parent);
  if (ca) {
    delete ca._children[this._id];
  }
  CanceledError = require('../gen-vdl/v.io/v23/verror').CanceledError;
  this._cancel(new CanceledError(this));
};

CancelContext.prototype.finish = function() {
  this._cancel(null);
};

CancelContext.prototype.waitUntilDone = function(callback) {
  this._deferred.addCallback(callback);
  return this._deferred.promise;
};

// A DeadlineContext cancels itself when its deadline is met.
function DeadlineContext(parent, deadline) {
  this._deadline = deadline;

  // deadline could be a BigInt. In order to use this timeout, it must be
  // converted to a native number.
  if (deadline instanceof BigInt) {
    this._deadline = deadline.toNativeNumberApprox();
  }

  this._timerID = setTimeout(this._expire.bind(this),
    this._deadline - Date.now());

  CancelContext.call(this, parent);
}
inherits(DeadlineContext, CancelContext);

DeadlineContext.prototype.deadline = function() {
  return this._deadline;
};

DeadlineContext.prototype._cancel = function(error) {
  clearTimeout(this._timerID);
  CancelContext.prototype._cancel.call(this, error);
};

DeadlineContext.prototype._expire = function(error) {
  this._cancel(new vError.TimeoutError(this));
};

},{"../context/context-key":47,"../gen-vdl/v.io/v23/verror":57,"../lib/deferred":69,"../lib/promise":73,"../vdl/big-int":124,"inherits":32}],49:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../vdl');
var canonicalize = require('../../../../vdl/canonicalize');





var time = require('./../vdlroot/time');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _typeGlobChildrenReply = new vdl.Type();
var _typeGlobError = new vdl.Type();
var _typeGlobReply = new vdl.Type();
var _typeMountEntry = new vdl.Type();
var _typeMountFlag = new vdl.Type();
var _typeMountedServer = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = _typeMountedServer;
_typeGlobChildrenReply.kind = vdl.kind.UNION;
_typeGlobChildrenReply.name = "v.io/v23/naming.GlobChildrenReply";
_typeGlobChildrenReply.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Error", type: _typeGlobError}];
_typeGlobError.kind = vdl.kind.STRUCT;
_typeGlobError.name = "v.io/v23/naming.GlobError";
_typeGlobError.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Error", type: vdl.types.ERROR}];
_typeGlobReply.kind = vdl.kind.UNION;
_typeGlobReply.name = "v.io/v23/naming.GlobReply";
_typeGlobReply.fields = [{name: "Entry", type: _typeMountEntry}, {name: "Error", type: _typeGlobError}];
_typeMountEntry.kind = vdl.kind.STRUCT;
_typeMountEntry.name = "v.io/v23/naming.MountEntry";
_typeMountEntry.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Servers", type: _type1}, {name: "ServesMountTable", type: vdl.types.BOOL}, {name: "IsLeaf", type: vdl.types.BOOL}];
_typeMountFlag.kind = vdl.kind.UINT32;
_typeMountFlag.name = "v.io/v23/naming.MountFlag";
_typeMountedServer.kind = vdl.kind.STRUCT;
_typeMountedServer.name = "v.io/v23/naming.MountedServer";
_typeMountedServer.fields = [{name: "Server", type: vdl.types.STRING}, {name: "Deadline", type: new time.WireDeadline()._type}];
_type1.freeze();
_typeGlobChildrenReply.freeze();
_typeGlobError.freeze();
_typeGlobReply.freeze();
_typeMountEntry.freeze();
_typeMountFlag.freeze();
_typeMountedServer.freeze();
module.exports.GlobChildrenReply = (vdl.registry.lookupOrCreateConstructor(_typeGlobChildrenReply));
module.exports.GlobError = (vdl.registry.lookupOrCreateConstructor(_typeGlobError));
module.exports.GlobReply = (vdl.registry.lookupOrCreateConstructor(_typeGlobReply));
module.exports.MountEntry = (vdl.registry.lookupOrCreateConstructor(_typeMountEntry));
module.exports.MountFlag = (vdl.registry.lookupOrCreateConstructor(_typeMountFlag));
module.exports.MountedServer = (vdl.registry.lookupOrCreateConstructor(_typeMountedServer));




// Consts:

  module.exports.Replace = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeMountFlag))(1, true), _typeMountFlag);

  module.exports.MT = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeMountFlag))(2, true), _typeMountFlag);

  module.exports.Leaf = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeMountFlag))(4, true), _typeMountFlag);



// Errors:



// Services:

   
 



},{"../../../../vdl":133,"../../../../vdl/canonicalize":126,"./../vdlroot/time":56}],50:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../vdl');
var canonicalize = require('../../../../vdl/canonicalize');





var time = require('./../vdlroot/time');
var security = require('./../security');
var vtrace = require('./../vtrace');

module.exports = {};



// Types:
var _typeRequest = new vdl.Type();
var _typeResponse = new vdl.Type();
_typeRequest.kind = vdl.kind.STRUCT;
_typeRequest.name = "v.io/v23/rpc.Request";
_typeRequest.fields = [{name: "Suffix", type: vdl.types.STRING}, {name: "Method", type: vdl.types.STRING}, {name: "NumPosArgs", type: vdl.types.UINT64}, {name: "EndStreamArgs", type: vdl.types.BOOL}, {name: "Deadline", type: new time.WireDeadline()._type}, {name: "GrantedBlessings", type: new security.WireBlessings()._type}, {name: "TraceRequest", type: new vtrace.Request()._type}, {name: "Language", type: vdl.types.STRING}];
_typeResponse.kind = vdl.kind.STRUCT;
_typeResponse.name = "v.io/v23/rpc.Response";
_typeResponse.fields = [{name: "Error", type: vdl.types.ERROR}, {name: "EndStreamResults", type: vdl.types.BOOL}, {name: "NumPosResults", type: vdl.types.UINT64}, {name: "TraceResponse", type: new vtrace.Response()._type}, {name: "AckBlessings", type: vdl.types.BOOL}];
_typeRequest.freeze();
_typeResponse.freeze();
module.exports.Request = (vdl.registry.lookupOrCreateConstructor(_typeRequest));
module.exports.Response = (vdl.registry.lookupOrCreateConstructor(_typeResponse));




// Consts:

  module.exports.GlobMethod = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.STRING))("__Glob", true), vdl.types.STRING);

  module.exports.ReservedSignature = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.STRING))("__Signature", true), vdl.types.STRING);

  module.exports.ReservedMethodSignature = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.STRING))("__MethodSignature", true), vdl.types.STRING);



// Errors:



// Services:

   
 



},{"../../../../vdl":133,"../../../../vdl/canonicalize":126,"./../security":53,"./../vdlroot/time":56,"./../vtrace":59}],51:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../vdl');
var makeError = require('../../../../../verror/make-errors');
var actions = require('../../../../../verror/actions');






module.exports = {};



// Types:




// Consts:



// Errors:

module.exports.GlobMaxRecursionReachedError = makeError('v.io/v23/rpc/reserved.GlobMaxRecursionReached', actions.NO_RETRY, {
  'en': '{1:}{2:} max recursion level reached{:_}',
}, [
]);


module.exports.GlobMatchesOmittedError = makeError('v.io/v23/rpc/reserved.GlobMatchesOmitted', actions.NO_RETRY, {
  'en': '{1:}{2:} some matches might have been omitted',
}, [
]);


module.exports.GlobNotImplementedError = makeError('v.io/v23/rpc/reserved.GlobNotImplemented', actions.NO_RETRY, {
  'en': '{1:}{2:} Glob not implemented',
}, [
]);




// Services:

   
 



},{"../../../../../vdl":133,"../../../../../verror/actions":148,"../../../../../verror/make-errors":152}],52:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../vdl');
var makeError = require('../../../../../verror/make-errors');
var actions = require('../../../../../verror/actions');
var canonicalize = require('../../../../../vdl/canonicalize');





var security = require('./..');
var uniqueid = require('./../../uniqueid');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _type2 = new vdl.Type();
var _type3 = new vdl.Type();
var _type4 = new vdl.Type();
var _typeAccessList = new vdl.Type();
var _typePermissions = new vdl.Type();
var _typeTag = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = new security.BlessingPattern()._type;
_type2.kind = vdl.kind.LIST;
_type2.name = "";
_type2.elem = vdl.types.STRING;
_type3.kind = vdl.kind.LIST;
_type3.name = "";
_type3.elem = _typeTag;
_type4.kind = vdl.kind.LIST;
_type4.name = "";
_type4.elem = new security.RejectedBlessing()._type;
_typeAccessList.kind = vdl.kind.STRUCT;
_typeAccessList.name = "v.io/v23/security/access.AccessList";
_typeAccessList.fields = [{name: "In", type: _type1}, {name: "NotIn", type: _type2}];
_typePermissions.kind = vdl.kind.MAP;
_typePermissions.name = "v.io/v23/security/access.Permissions";
_typePermissions.elem = _typeAccessList;
_typePermissions.key = vdl.types.STRING;
_typeTag.kind = vdl.kind.STRING;
_typeTag.name = "v.io/v23/security/access.Tag";
_type1.freeze();
_type2.freeze();
_type3.freeze();
_type4.freeze();
_typeAccessList.freeze();
_typePermissions.freeze();
_typeTag.freeze();
module.exports.AccessList = (vdl.registry.lookupOrCreateConstructor(_typeAccessList));
module.exports.Permissions = (vdl.registry.lookupOrCreateConstructor(_typePermissions));
module.exports.Tag = (vdl.registry.lookupOrCreateConstructor(_typeTag));




// Consts:

  module.exports.Admin = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeTag))("Admin", true), _typeTag);

  module.exports.Debug = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeTag))("Debug", true), _typeTag);

  module.exports.Read = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeTag))("Read", true), _typeTag);

  module.exports.Write = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeTag))("Write", true), _typeTag);

  module.exports.Resolve = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeTag))("Resolve", true), _typeTag);

  module.exports.AccessTagCaveat = canonicalize.reduce(new security.CaveatDescriptor({
  'id': new Uint8Array([
239,
205,
227,
117,
20,
22,
199,
59,
24,
156,
232,
156,
204,
147,
128,
0,
]),
  'paramType': _type3,
}, true), new security.CaveatDescriptor()._type);



// Errors:

module.exports.TooBigError = makeError('v.io/v23/security/access.TooBig', actions.NO_RETRY, {
  'en': '{1:}{2:} AccessList is too big',
}, [
]);


module.exports.NoPermissionsError = makeError('v.io/v23/security/access.NoPermissions', actions.NO_RETRY, {
  'en': '{1:}{2:} {3} does not have {5} access (rejected blessings: {4})',
}, [
  _type2,
  _type4,
  vdl.types.STRING,
]);


module.exports.AccessListMatchError = makeError('v.io/v23/security/access.AccessListMatch', actions.NO_RETRY, {
  'en': '{1:}{2:} {3} does not match the access list (rejected blessings: {4})',
}, [
  _type2,
  _type4,
]);


module.exports.UnenforceablePatternsError = makeError('v.io/v23/security/access.UnenforceablePatterns', actions.NO_RETRY, {
  'en': '{1:}{2:} AccessList contains the following invalid or unrecognized patterns in the In list: {3}',
}, [
  _type1,
]);


module.exports.InvalidOpenAccessListError = makeError('v.io/v23/security/access.InvalidOpenAccessList', actions.NO_RETRY, {
  'en': '{1:}{2:} AccessList with the pattern ... in its In list must have no other patterns in the In or NotIn lists',
}, [
]);


module.exports.AccessTagCaveatValidationError = makeError('v.io/v23/security/access.AccessTagCaveatValidation', actions.NO_RETRY, {
  'en': '{1:}{2:} access tags on method ({3}) do not include any of the ones in the caveat ({4}), or the method is using a different tag type',
}, [
  _type2,
  _type3,
]);




// Services:

   
 



},{"../../../../../vdl":133,"../../../../../vdl/canonicalize":126,"../../../../../verror/actions":148,"../../../../../verror/make-errors":152,"./..":53,"./../../uniqueid":54}],53:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../vdl');
var makeError = require('../../../../verror/make-errors');
var actions = require('../../../../verror/actions');
var canonicalize = require('../../../../vdl/canonicalize');





var time = require('./../vdlroot/time');
var uniqueid = require('./../uniqueid');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _type2 = new vdl.Type();
var _type3 = new vdl.Type();
var _type4 = new vdl.Type();
var _type5 = new vdl.Type();
var _type6 = new vdl.Type();
var _type7 = new vdl.Type();
var _type8 = new vdl.Type();
var _typeBlessingPattern = new vdl.Type();
var _typeCaveat = new vdl.Type();
var _typeCaveatDescriptor = new vdl.Type();
var _typeCertificate = new vdl.Type();
var _typeDischargeImpetus = new vdl.Type();
var _typeHash = new vdl.Type();
var _typeRejectedBlessing = new vdl.Type();
var _typeSignature = new vdl.Type();
var _typeThirdPartyRequirements = new vdl.Type();
var _typeWireBlessings = new vdl.Type();
var _typeWireDischarge = new vdl.Type();
var _typenonce = new vdl.Type();
var _typepublicKeyDischarge = new vdl.Type();
var _typepublicKeyThirdPartyCaveatParam = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = _typeCaveat;
_type2.kind = vdl.kind.LIST;
_type2.name = "";
_type2.elem = vdl.types.BYTE;
_type3.kind = vdl.kind.LIST;
_type3.name = "";
_type3.elem = vdl.types.STRING;
_type4.kind = vdl.kind.LIST;
_type4.name = "";
_type4.elem = _typeBlessingPattern;
_type5.kind = vdl.kind.LIST;
_type5.name = "";
_type5.elem = vdl.types.ANY;
_type6.kind = vdl.kind.LIST;
_type6.name = "";
_type6.elem = _type7;
_type7.kind = vdl.kind.LIST;
_type7.name = "";
_type7.elem = _typeCertificate;
_type8.kind = vdl.kind.LIST;
_type8.name = "";
_type8.elem = _typeRejectedBlessing;
_typeBlessingPattern.kind = vdl.kind.STRING;
_typeBlessingPattern.name = "v.io/v23/security.BlessingPattern";
_typeCaveat.kind = vdl.kind.STRUCT;
_typeCaveat.name = "v.io/v23/security.Caveat";
_typeCaveat.fields = [{name: "Id", type: new uniqueid.Id()._type}, {name: "ParamVom", type: _type2}];
_typeCaveatDescriptor.kind = vdl.kind.STRUCT;
_typeCaveatDescriptor.name = "v.io/v23/security.CaveatDescriptor";
_typeCaveatDescriptor.fields = [{name: "Id", type: new uniqueid.Id()._type}, {name: "ParamType", type: vdl.types.TYPEOBJECT}];
_typeCertificate.kind = vdl.kind.STRUCT;
_typeCertificate.name = "v.io/v23/security.Certificate";
_typeCertificate.fields = [{name: "Extension", type: vdl.types.STRING}, {name: "PublicKey", type: _type2}, {name: "Caveats", type: _type1}, {name: "Signature", type: _typeSignature}];
_typeDischargeImpetus.kind = vdl.kind.STRUCT;
_typeDischargeImpetus.name = "v.io/v23/security.DischargeImpetus";
_typeDischargeImpetus.fields = [{name: "Server", type: _type4}, {name: "Method", type: vdl.types.STRING}, {name: "Arguments", type: _type5}];
_typeHash.kind = vdl.kind.STRING;
_typeHash.name = "v.io/v23/security.Hash";
_typeRejectedBlessing.kind = vdl.kind.STRUCT;
_typeRejectedBlessing.name = "v.io/v23/security.RejectedBlessing";
_typeRejectedBlessing.fields = [{name: "Blessing", type: vdl.types.STRING}, {name: "Err", type: vdl.types.ERROR}];
_typeSignature.kind = vdl.kind.STRUCT;
_typeSignature.name = "v.io/v23/security.Signature";
_typeSignature.fields = [{name: "Purpose", type: _type2}, {name: "Hash", type: _typeHash}, {name: "R", type: _type2}, {name: "S", type: _type2}];
_typeThirdPartyRequirements.kind = vdl.kind.STRUCT;
_typeThirdPartyRequirements.name = "v.io/v23/security.ThirdPartyRequirements";
_typeThirdPartyRequirements.fields = [{name: "ReportServer", type: vdl.types.BOOL}, {name: "ReportMethod", type: vdl.types.BOOL}, {name: "ReportArguments", type: vdl.types.BOOL}];
_typeWireBlessings.kind = vdl.kind.STRUCT;
_typeWireBlessings.name = "v.io/v23/security.WireBlessings";
_typeWireBlessings.fields = [{name: "CertificateChains", type: _type6}];
_typeWireDischarge.kind = vdl.kind.UNION;
_typeWireDischarge.name = "v.io/v23/security.WireDischarge";
_typeWireDischarge.fields = [{name: "PublicKey", type: _typepublicKeyDischarge}];
_typenonce.kind = vdl.kind.ARRAY;
_typenonce.name = "v.io/v23/security.nonce";
_typenonce.len = 16;
_typenonce.elem = vdl.types.BYTE;
_typepublicKeyDischarge.kind = vdl.kind.STRUCT;
_typepublicKeyDischarge.name = "v.io/v23/security.publicKeyDischarge";
_typepublicKeyDischarge.fields = [{name: "ThirdPartyCaveatId", type: vdl.types.STRING}, {name: "Caveats", type: _type1}, {name: "Signature", type: _typeSignature}];
_typepublicKeyThirdPartyCaveatParam.kind = vdl.kind.STRUCT;
_typepublicKeyThirdPartyCaveatParam.name = "v.io/v23/security.publicKeyThirdPartyCaveatParam";
_typepublicKeyThirdPartyCaveatParam.fields = [{name: "Nonce", type: _typenonce}, {name: "Caveats", type: _type1}, {name: "DischargerKey", type: _type2}, {name: "DischargerLocation", type: vdl.types.STRING}, {name: "DischargerRequirements", type: _typeThirdPartyRequirements}];
_type1.freeze();
_type2.freeze();
_type3.freeze();
_type4.freeze();
_type5.freeze();
_type6.freeze();
_type7.freeze();
_type8.freeze();
_typeBlessingPattern.freeze();
_typeCaveat.freeze();
_typeCaveatDescriptor.freeze();
_typeCertificate.freeze();
_typeDischargeImpetus.freeze();
_typeHash.freeze();
_typeRejectedBlessing.freeze();
_typeSignature.freeze();
_typeThirdPartyRequirements.freeze();
_typeWireBlessings.freeze();
_typeWireDischarge.freeze();
_typenonce.freeze();
_typepublicKeyDischarge.freeze();
_typepublicKeyThirdPartyCaveatParam.freeze();
module.exports.BlessingPattern = (vdl.registry.lookupOrCreateConstructor(_typeBlessingPattern));
module.exports.Caveat = (vdl.registry.lookupOrCreateConstructor(_typeCaveat));
module.exports.CaveatDescriptor = (vdl.registry.lookupOrCreateConstructor(_typeCaveatDescriptor));
module.exports.Certificate = (vdl.registry.lookupOrCreateConstructor(_typeCertificate));
module.exports.DischargeImpetus = (vdl.registry.lookupOrCreateConstructor(_typeDischargeImpetus));
module.exports.Hash = (vdl.registry.lookupOrCreateConstructor(_typeHash));
module.exports.RejectedBlessing = (vdl.registry.lookupOrCreateConstructor(_typeRejectedBlessing));
module.exports.Signature = (vdl.registry.lookupOrCreateConstructor(_typeSignature));
module.exports.ThirdPartyRequirements = (vdl.registry.lookupOrCreateConstructor(_typeThirdPartyRequirements));
module.exports.WireBlessings = (vdl.registry.lookupOrCreateConstructor(_typeWireBlessings));
module.exports.WireDischarge = (vdl.registry.lookupOrCreateConstructor(_typeWireDischarge));
module.exports.nonce = (vdl.registry.lookupOrCreateConstructor(_typenonce));
module.exports.publicKeyDischarge = (vdl.registry.lookupOrCreateConstructor(_typepublicKeyDischarge));
module.exports.publicKeyThirdPartyCaveatParam = (vdl.registry.lookupOrCreateConstructor(_typepublicKeyThirdPartyCaveatParam));




// Consts:

  module.exports.ConstCaveat = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeCaveatDescriptor))({
  'id': new Uint8Array([
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
]),
  'paramType': vdl.types.BOOL,
}, true), _typeCaveatDescriptor);

  module.exports.ExpiryCaveat = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeCaveatDescriptor))({
  'id': new Uint8Array([
166,
76,
45,
1,
25,
251,
163,
52,
128,
113,
254,
235,
47,
48,
128,
0,
]),
  'paramType': new time.Time()._type,
}, true), _typeCaveatDescriptor);

  module.exports.MethodCaveat = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeCaveatDescriptor))({
  'id': new Uint8Array([
84,
166,
118,
57,
129,
55,
24,
126,
205,
178,
109,
45,
105,
186,
0,
3,
]),
  'paramType': _type3,
}, true), _typeCaveatDescriptor);

  module.exports.PublicKeyThirdPartyCaveat = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeCaveatDescriptor))({
  'id': new Uint8Array([
121,
114,
206,
23,
74,
123,
169,
63,
121,
84,
125,
118,
156,
145,
128,
0,
]),
  'paramType': _typepublicKeyThirdPartyCaveatParam,
}, true), _typeCaveatDescriptor);

  module.exports.PeerBlessingsCaveat = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeCaveatDescriptor))({
  'id': new Uint8Array([
5,
119,
248,
86,
76,
142,
95,
254,
255,
142,
43,
31,
77,
109,
128,
0,
]),
  'paramType': _type4,
}, true), _typeCaveatDescriptor);

  module.exports.NoExtension = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeBlessingPattern))("$", true), _typeBlessingPattern);

  module.exports.AllPrincipals = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeBlessingPattern))("...", true), _typeBlessingPattern);

  module.exports.ChainSeparator = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.STRING))(":", true), vdl.types.STRING);

  module.exports.SHA1Hash = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeHash))("SHA1", true), _typeHash);

  module.exports.SHA256Hash = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeHash))("SHA256", true), _typeHash);

  module.exports.SHA384Hash = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeHash))("SHA384", true), _typeHash);

  module.exports.SHA512Hash = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeHash))("SHA512", true), _typeHash);

  module.exports.SignatureForMessageSigning = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.STRING))("S1", true), vdl.types.STRING);

  module.exports.SignatureForBlessingCertificates = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.STRING))("B1", true), vdl.types.STRING);

  module.exports.SignatureForDischarge = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.STRING))("D1", true), vdl.types.STRING);



// Errors:

module.exports.CaveatNotRegisteredError = makeError('v.io/v23/security.CaveatNotRegistered', actions.NO_RETRY, {
  'en': '{1:}{2:} no validation function registered for caveat id {3}',
}, [
  new uniqueid.Id()._type,
]);


module.exports.CaveatParamAnyError = makeError('v.io/v23/security.CaveatParamAny', actions.NO_RETRY, {
  'en': '{1:}{2:} caveat {3} uses illegal param type any',
}, [
  new uniqueid.Id()._type,
]);


module.exports.CaveatParamTypeMismatchError = makeError('v.io/v23/security.CaveatParamTypeMismatch', actions.NO_RETRY, {
  'en': '{1:}{2:} bad param type: caveat {3} got {4}, want {5}',
}, [
  new uniqueid.Id()._type,
  vdl.types.TYPEOBJECT,
  vdl.types.TYPEOBJECT,
]);


module.exports.CaveatParamCodingError = makeError('v.io/v23/security.CaveatParamCoding', actions.NO_RETRY, {
  'en': '{1:}{2:} unable to encode/decode caveat param(type={4}) for caveat {3}: {5}',
}, [
  new uniqueid.Id()._type,
  vdl.types.TYPEOBJECT,
  vdl.types.ERROR,
]);


module.exports.CaveatValidationError = makeError('v.io/v23/security.CaveatValidation', actions.NO_RETRY, {
  'en': '{1:}{2:} caveat validation failed: {3}',
}, [
  vdl.types.ERROR,
]);


module.exports.ConstCaveatValidationError = makeError('v.io/v23/security.ConstCaveatValidation', actions.NO_RETRY, {
  'en': '{1:}{2:} false const caveat always fails validation',
}, [
]);


module.exports.ExpiryCaveatValidationError = makeError('v.io/v23/security.ExpiryCaveatValidation', actions.NO_RETRY, {
  'en': '{1:}{2:} now({3}) is after expiry({4})',
}, [
  new time.Time()._type,
  new time.Time()._type,
]);


module.exports.MethodCaveatValidationError = makeError('v.io/v23/security.MethodCaveatValidation', actions.NO_RETRY, {
  'en': '{1:}{2:} method {3} not in list {4}',
}, [
  vdl.types.STRING,
  _type3,
]);


module.exports.PeerBlessingsCaveatValidationError = makeError('v.io/v23/security.PeerBlessingsCaveatValidation', actions.NO_RETRY, {
  'en': '{1:}{2:} patterns in peer blessings caveat {4} not matched by the peer {3}',
}, [
  _type3,
  _type4,
]);


module.exports.UnrecognizedRootError = makeError('v.io/v23/security.UnrecognizedRoot', actions.NO_RETRY, {
  'en': '{1:}{2:} unrecognized public key {3} in root certificate{:4}',
}, [
  vdl.types.STRING,
  vdl.types.ERROR,
]);


module.exports.AuthorizationFailedError = makeError('v.io/v23/security.AuthorizationFailed', actions.NO_RETRY, {
  'en': '{1:}{2:} principal with blessings {3} (rejected {4}) is not authorized by principal with blessings {5}',
}, [
  _type3,
  _type8,
  _type3,
]);


module.exports.InvalidSigningBlessingCaveatError = makeError('v.io/v23/security.InvalidSigningBlessingCaveat', actions.NO_RETRY, {
  'en': '{1:}{2:} blessing has caveat with UUID {3} which makes it unsuitable for signing -- please use blessings with just Expiry caveats',
}, [
  new uniqueid.Id()._type,
]);


module.exports.PublicKeyNotAllowedError = makeError('v.io/v23/security.PublicKeyNotAllowed', actions.NO_RETRY, {
  'en': '{1:}{2:} peer has public key {3}, not the authorized public key {4}',
}, [
  vdl.types.STRING,
  vdl.types.STRING,
]);


module.exports.EndpointAuthorizationFailedError = makeError('v.io/v23/security.EndpointAuthorizationFailed', actions.NO_RETRY, {
  'en': '{1:}{2:} blessings in endpoint {3} not matched by blessings presented: {4} (rejected {5})',
}, [
  vdl.types.STRING,
  _type3,
  _type8,
]);




// Services:

   

   
 



},{"../../../../vdl":133,"../../../../vdl/canonicalize":126,"../../../../verror/actions":148,"../../../../verror/make-errors":152,"./../uniqueid":54,"./../vdlroot/time":56}],54:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../vdl');






module.exports = {};



// Types:
var _typeId = new vdl.Type();
_typeId.kind = vdl.kind.ARRAY;
_typeId.name = "v.io/v23/uniqueid.Id";
_typeId.len = 16;
_typeId.elem = vdl.types.BYTE;
_typeId.freeze();
module.exports.Id = (vdl.registry.lookupOrCreateConstructor(_typeId));




// Consts:



// Errors:



// Services:

   
 



},{"../../../../vdl":133}],55:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../vdl');






module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _type2 = new vdl.Type();
var _type3 = new vdl.Type();
var _type4 = new vdl.Type();
var _type5 = new vdl.Type();
var _typeArg = new vdl.Type();
var _typeEmbed = new vdl.Type();
var _typeInterface = new vdl.Type();
var _typeMethod = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = _typeEmbed;
_type2.kind = vdl.kind.LIST;
_type2.name = "";
_type2.elem = _typeMethod;
_type3.kind = vdl.kind.LIST;
_type3.name = "";
_type3.elem = _typeArg;
_type4.kind = vdl.kind.OPTIONAL;
_type4.name = "";
_type4.elem = _typeArg;
_type5.kind = vdl.kind.LIST;
_type5.name = "";
_type5.elem = vdl.types.ANY;
_typeArg.kind = vdl.kind.STRUCT;
_typeArg.name = "signature.Arg";
_typeArg.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Doc", type: vdl.types.STRING}, {name: "Type", type: vdl.types.TYPEOBJECT}];
_typeEmbed.kind = vdl.kind.STRUCT;
_typeEmbed.name = "signature.Embed";
_typeEmbed.fields = [{name: "Name", type: vdl.types.STRING}, {name: "PkgPath", type: vdl.types.STRING}, {name: "Doc", type: vdl.types.STRING}];
_typeInterface.kind = vdl.kind.STRUCT;
_typeInterface.name = "signature.Interface";
_typeInterface.fields = [{name: "Name", type: vdl.types.STRING}, {name: "PkgPath", type: vdl.types.STRING}, {name: "Doc", type: vdl.types.STRING}, {name: "Embeds", type: _type1}, {name: "Methods", type: _type2}];
_typeMethod.kind = vdl.kind.STRUCT;
_typeMethod.name = "signature.Method";
_typeMethod.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Doc", type: vdl.types.STRING}, {name: "InArgs", type: _type3}, {name: "OutArgs", type: _type3}, {name: "InStream", type: _type4}, {name: "OutStream", type: _type4}, {name: "Tags", type: _type5}];
_type1.freeze();
_type2.freeze();
_type3.freeze();
_type4.freeze();
_type5.freeze();
_typeArg.freeze();
_typeEmbed.freeze();
_typeInterface.freeze();
_typeMethod.freeze();
module.exports.Arg = (vdl.registry.lookupOrCreateConstructor(_typeArg));
module.exports.Embed = (vdl.registry.lookupOrCreateConstructor(_typeEmbed));
module.exports.Interface = (vdl.registry.lookupOrCreateConstructor(_typeInterface));
module.exports.Method = (vdl.registry.lookupOrCreateConstructor(_typeMethod));




// Consts:



// Errors:



// Services:

   
 



},{"../../../../../vdl":133}],56:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../vdl');






module.exports = {};



// Types:
var _typeDuration = new vdl.Type();
var _typeTime = new vdl.Type();
var _typeWireDeadline = new vdl.Type();
_typeDuration.kind = vdl.kind.STRUCT;
_typeDuration.name = "time.Duration";
_typeDuration.fields = [{name: "Seconds", type: vdl.types.INT64}, {name: "Nanos", type: vdl.types.INT32}];
_typeTime.kind = vdl.kind.STRUCT;
_typeTime.name = "time.Time";
_typeTime.fields = [{name: "Seconds", type: vdl.types.INT64}, {name: "Nanos", type: vdl.types.INT32}];
_typeWireDeadline.kind = vdl.kind.STRUCT;
_typeWireDeadline.name = "time.WireDeadline";
_typeWireDeadline.fields = [{name: "FromNow", type: _typeDuration}, {name: "NoDeadline", type: vdl.types.BOOL}];
_typeDuration.freeze();
_typeTime.freeze();
_typeWireDeadline.freeze();
module.exports.Duration = (vdl.registry.lookupOrCreateConstructor(_typeDuration));
module.exports.Time = (vdl.registry.lookupOrCreateConstructor(_typeTime));
module.exports.WireDeadline = (vdl.registry.lookupOrCreateConstructor(_typeWireDeadline));




// Consts:



// Errors:



// Services:

   
 



},{"../../../../../vdl":133}],57:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../vdl');
var makeError = require('../../../../verror/make-errors');
var actions = require('../../../../verror/actions');






module.exports = {};



// Types:




// Consts:



// Errors:

module.exports.UnknownError = makeError('v.io/v23/verror.Unknown', actions.NO_RETRY, {
  'en': '{1:}{2:} Error{:_}',
}, [
]);


module.exports.InternalError = makeError('v.io/v23/verror.Internal', actions.NO_RETRY, {
  'en': '{1:}{2:} Internal error{:_}',
}, [
]);


module.exports.NotImplementedError = makeError('v.io/v23/verror.NotImplemented', actions.NO_RETRY, {
  'en': '{1:}{2:} Not implemented{:_}',
}, [
]);


module.exports.EndOfFileError = makeError('v.io/v23/verror.EndOfFile', actions.NO_RETRY, {
  'en': '{1:}{2:} End of file{:_}',
}, [
]);


module.exports.BadArgError = makeError('v.io/v23/verror.BadArg', actions.NO_RETRY, {
  'en': '{1:}{2:} Bad argument{:_}',
}, [
]);


module.exports.BadStateError = makeError('v.io/v23/verror.BadState', actions.NO_RETRY, {
  'en': '{1:}{2:} Invalid state{:_}',
}, [
]);


module.exports.BadVersionError = makeError('v.io/v23/verror.BadVersion', actions.NO_RETRY, {
  'en': '{1:}{2:} Version is out of date',
}, [
]);


module.exports.ExistError = makeError('v.io/v23/verror.Exist', actions.NO_RETRY, {
  'en': '{1:}{2:} Already exists{:_}',
}, [
]);


module.exports.NoExistError = makeError('v.io/v23/verror.NoExist', actions.NO_RETRY, {
  'en': '{1:}{2:} Does not exist{:_}',
}, [
]);


module.exports.UnknownMethodError = makeError('v.io/v23/verror.UnknownMethod', actions.NO_RETRY, {
  'en': '{1:}{2:} Method does not exist{:_}',
}, [
]);


module.exports.UnknownSuffixError = makeError('v.io/v23/verror.UnknownSuffix', actions.NO_RETRY, {
  'en': '{1:}{2:} Suffix does not exist{:_}',
}, [
]);


module.exports.NoExistOrNoAccessError = makeError('v.io/v23/verror.NoExistOrNoAccess', actions.NO_RETRY, {
  'en': '{1:}{2:} Does not exist or access denied{:_}',
}, [
]);


module.exports.NoServersError = makeError('v.io/v23/verror.NoServers', actions.RETRY_REFETCH, {
  'en': '{1:}{2:} No usable servers found{:_}',
}, [
]);


module.exports.NoAccessError = makeError('v.io/v23/verror.NoAccess', actions.RETRY_REFETCH, {
  'en': '{1:}{2:} Access denied{:_}',
}, [
]);


module.exports.NotTrustedError = makeError('v.io/v23/verror.NotTrusted', actions.RETRY_REFETCH, {
  'en': '{1:}{2:} Client does not trust server{:_}',
}, [
]);


module.exports.AbortedError = makeError('v.io/v23/verror.Aborted', actions.NO_RETRY, {
  'en': '{1:}{2:} Aborted{:_}',
}, [
]);


module.exports.BadProtocolError = makeError('v.io/v23/verror.BadProtocol', actions.NO_RETRY, {
  'en': '{1:}{2:} Bad protocol or type{:_}',
}, [
]);


module.exports.CanceledError = makeError('v.io/v23/verror.Canceled', actions.NO_RETRY, {
  'en': '{1:}{2:} Canceled{:_}',
}, [
]);


module.exports.TimeoutError = makeError('v.io/v23/verror.Timeout', actions.NO_RETRY, {
  'en': '{1:}{2:} Timeout{:_}',
}, [
]);




// Services:

   
 



},{"../../../../vdl":133,"../../../../verror/actions":148,"../../../../verror/make-errors":152}],58:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../vdl');
var canonicalize = require('../../../../vdl/canonicalize');






module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _type2 = new vdl.Type();
var _type3 = new vdl.Type();
var _typeControlKind = new vdl.Type();
var _typeDumpAtom = new vdl.Type();
var _typeDumpKind = new vdl.Type();
var _typePrimitive = new vdl.Type();
var _typetypeId = new vdl.Type();
var _typewireArray = new vdl.Type();
var _typewireEnum = new vdl.Type();
var _typewireField = new vdl.Type();
var _typewireList = new vdl.Type();
var _typewireMap = new vdl.Type();
var _typewireNamed = new vdl.Type();
var _typewireOptional = new vdl.Type();
var _typewireSet = new vdl.Type();
var _typewireStruct = new vdl.Type();
var _typewireType = new vdl.Type();
var _typewireUnion = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = vdl.types.BYTE;
_type2.kind = vdl.kind.LIST;
_type2.name = "";
_type2.elem = vdl.types.STRING;
_type3.kind = vdl.kind.LIST;
_type3.name = "";
_type3.elem = _typewireField;
_typeControlKind.kind = vdl.kind.ENUM;
_typeControlKind.name = "v.io/v23/vom.ControlKind";
_typeControlKind.labels = ["Nil", "End", "IncompleteType"];
_typeDumpAtom.kind = vdl.kind.STRUCT;
_typeDumpAtom.name = "v.io/v23/vom.DumpAtom";
_typeDumpAtom.fields = [{name: "Kind", type: _typeDumpKind}, {name: "Bytes", type: _type1}, {name: "Data", type: _typePrimitive}, {name: "Debug", type: vdl.types.STRING}];
_typeDumpKind.kind = vdl.kind.ENUM;
_typeDumpKind.name = "v.io/v23/vom.DumpKind";
_typeDumpKind.labels = ["Version", "Control", "MsgId", "TypeMsg", "ValueMsg", "MsgLen", "AnyMsgLen", "AnyLensLen", "TypeIdsLen", "TypeId", "PrimValue", "ByteLen", "ValueLen", "Index", "WireTypeIndex"];
_typePrimitive.kind = vdl.kind.UNION;
_typePrimitive.name = "v.io/v23/vom.Primitive";
_typePrimitive.fields = [{name: "PBool", type: vdl.types.BOOL}, {name: "PByte", type: vdl.types.BYTE}, {name: "PUint", type: vdl.types.UINT64}, {name: "PInt", type: vdl.types.INT64}, {name: "PFloat", type: vdl.types.FLOAT64}, {name: "PString", type: vdl.types.STRING}, {name: "PControl", type: _typeControlKind}];
_typetypeId.kind = vdl.kind.UINT64;
_typetypeId.name = "v.io/v23/vom.typeId";
_typewireArray.kind = vdl.kind.STRUCT;
_typewireArray.name = "v.io/v23/vom.wireArray";
_typewireArray.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Elem", type: _typetypeId}, {name: "Len", type: vdl.types.UINT64}];
_typewireEnum.kind = vdl.kind.STRUCT;
_typewireEnum.name = "v.io/v23/vom.wireEnum";
_typewireEnum.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Labels", type: _type2}];
_typewireField.kind = vdl.kind.STRUCT;
_typewireField.name = "v.io/v23/vom.wireField";
_typewireField.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Type", type: _typetypeId}];
_typewireList.kind = vdl.kind.STRUCT;
_typewireList.name = "v.io/v23/vom.wireList";
_typewireList.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Elem", type: _typetypeId}];
_typewireMap.kind = vdl.kind.STRUCT;
_typewireMap.name = "v.io/v23/vom.wireMap";
_typewireMap.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Key", type: _typetypeId}, {name: "Elem", type: _typetypeId}];
_typewireNamed.kind = vdl.kind.STRUCT;
_typewireNamed.name = "v.io/v23/vom.wireNamed";
_typewireNamed.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Base", type: _typetypeId}];
_typewireOptional.kind = vdl.kind.STRUCT;
_typewireOptional.name = "v.io/v23/vom.wireOptional";
_typewireOptional.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Elem", type: _typetypeId}];
_typewireSet.kind = vdl.kind.STRUCT;
_typewireSet.name = "v.io/v23/vom.wireSet";
_typewireSet.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Key", type: _typetypeId}];
_typewireStruct.kind = vdl.kind.STRUCT;
_typewireStruct.name = "v.io/v23/vom.wireStruct";
_typewireStruct.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Fields", type: _type3}];
_typewireType.kind = vdl.kind.UNION;
_typewireType.name = "v.io/v23/vom.wireType";
_typewireType.fields = [{name: "NamedT", type: _typewireNamed}, {name: "EnumT", type: _typewireEnum}, {name: "ArrayT", type: _typewireArray}, {name: "ListT", type: _typewireList}, {name: "SetT", type: _typewireSet}, {name: "MapT", type: _typewireMap}, {name: "StructT", type: _typewireStruct}, {name: "UnionT", type: _typewireUnion}, {name: "OptionalT", type: _typewireOptional}];
_typewireUnion.kind = vdl.kind.STRUCT;
_typewireUnion.name = "v.io/v23/vom.wireUnion";
_typewireUnion.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Fields", type: _type3}];
_type1.freeze();
_type2.freeze();
_type3.freeze();
_typeControlKind.freeze();
_typeDumpAtom.freeze();
_typeDumpKind.freeze();
_typePrimitive.freeze();
_typetypeId.freeze();
_typewireArray.freeze();
_typewireEnum.freeze();
_typewireField.freeze();
_typewireList.freeze();
_typewireMap.freeze();
_typewireNamed.freeze();
_typewireOptional.freeze();
_typewireSet.freeze();
_typewireStruct.freeze();
_typewireType.freeze();
_typewireUnion.freeze();
module.exports.ControlKind = {
  NIL: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeControlKind))('Nil', true), _typeControlKind),
  END: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeControlKind))('End', true), _typeControlKind),
  INCOMPLETE_TYPE: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeControlKind))('IncompleteType', true), _typeControlKind),
};
module.exports.DumpAtom = (vdl.registry.lookupOrCreateConstructor(_typeDumpAtom));
module.exports.DumpKind = {
  VERSION: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('Version', true), _typeDumpKind),
  CONTROL: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('Control', true), _typeDumpKind),
  MSG_ID: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('MsgId', true), _typeDumpKind),
  TYPE_MSG: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('TypeMsg', true), _typeDumpKind),
  VALUE_MSG: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('ValueMsg', true), _typeDumpKind),
  MSG_LEN: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('MsgLen', true), _typeDumpKind),
  ANY_MSG_LEN: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('AnyMsgLen', true), _typeDumpKind),
  ANY_LENS_LEN: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('AnyLensLen', true), _typeDumpKind),
  TYPE_IDS_LEN: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('TypeIdsLen', true), _typeDumpKind),
  TYPE_ID: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('TypeId', true), _typeDumpKind),
  PRIM_VALUE: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('PrimValue', true), _typeDumpKind),
  BYTE_LEN: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('ByteLen', true), _typeDumpKind),
  VALUE_LEN: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('ValueLen', true), _typeDumpKind),
  INDEX: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('Index', true), _typeDumpKind),
  WIRE_TYPE_INDEX: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeDumpKind))('WireTypeIndex', true), _typeDumpKind),
};
module.exports.Primitive = (vdl.registry.lookupOrCreateConstructor(_typePrimitive));
module.exports.typeId = (vdl.registry.lookupOrCreateConstructor(_typetypeId));
module.exports.wireArray = (vdl.registry.lookupOrCreateConstructor(_typewireArray));
module.exports.wireEnum = (vdl.registry.lookupOrCreateConstructor(_typewireEnum));
module.exports.wireField = (vdl.registry.lookupOrCreateConstructor(_typewireField));
module.exports.wireList = (vdl.registry.lookupOrCreateConstructor(_typewireList));
module.exports.wireMap = (vdl.registry.lookupOrCreateConstructor(_typewireMap));
module.exports.wireNamed = (vdl.registry.lookupOrCreateConstructor(_typewireNamed));
module.exports.wireOptional = (vdl.registry.lookupOrCreateConstructor(_typewireOptional));
module.exports.wireSet = (vdl.registry.lookupOrCreateConstructor(_typewireSet));
module.exports.wireStruct = (vdl.registry.lookupOrCreateConstructor(_typewireStruct));
module.exports.wireType = (vdl.registry.lookupOrCreateConstructor(_typewireType));
module.exports.wireUnion = (vdl.registry.lookupOrCreateConstructor(_typewireUnion));




// Consts:

  module.exports.WireIdBool = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x1])), true), _typetypeId);

  module.exports.WireIdByte = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x2])), true), _typetypeId);

  module.exports.WireIdString = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x3])), true), _typetypeId);

  module.exports.WireIdUint16 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x4])), true), _typetypeId);

  module.exports.WireIdUint32 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x5])), true), _typetypeId);

  module.exports.WireIdUint64 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x6])), true), _typetypeId);

  module.exports.WireIdInt16 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x7])), true), _typetypeId);

  module.exports.WireIdInt32 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x8])), true), _typetypeId);

  module.exports.WireIdInt64 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x9])), true), _typetypeId);

  module.exports.WireIdFloat32 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0xa])), true), _typetypeId);

  module.exports.WireIdFloat64 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0xb])), true), _typetypeId);

  module.exports.WireIdComplex64 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0xc])), true), _typetypeId);

  module.exports.WireIdComplex128 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0xd])), true), _typetypeId);

  module.exports.WireIdTypeObject = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0xe])), true), _typetypeId);

  module.exports.WireIdAny = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0xf])), true), _typetypeId);

  module.exports.WireIdInt8 = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x10])), true), _typetypeId);

  module.exports.WireIdByteList = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x27])), true), _typetypeId);

  module.exports.WireIdStringList = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x28])), true), _typetypeId);

  module.exports.WireIdFirstUserType = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typetypeId))(new vdl.BigInt(1, new Uint8Array([0x29])), true), _typetypeId);

  module.exports.WireCtrlNil = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.BYTE))(224, true), vdl.types.BYTE);

  module.exports.WireCtrlEnd = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.BYTE))(225, true), vdl.types.BYTE);

  module.exports.WireCtrlTypeIncomplete = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(vdl.types.BYTE))(226, true), vdl.types.BYTE);



// Errors:



// Services:

   

   
 



},{"../../../../vdl":133,"../../../../vdl/canonicalize":126}],59:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../vdl');
var canonicalize = require('../../../../vdl/canonicalize');





var time = require('./../vdlroot/time');
var uniqueid = require('./../uniqueid');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _type2 = new vdl.Type();
var _typeAnnotation = new vdl.Type();
var _typeRequest = new vdl.Type();
var _typeResponse = new vdl.Type();
var _typeSpanRecord = new vdl.Type();
var _typeTraceFlags = new vdl.Type();
var _typeTraceRecord = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = _typeSpanRecord;
_type2.kind = vdl.kind.LIST;
_type2.name = "";
_type2.elem = _typeAnnotation;
_typeAnnotation.kind = vdl.kind.STRUCT;
_typeAnnotation.name = "v.io/v23/vtrace.Annotation";
_typeAnnotation.fields = [{name: "When", type: new time.Time()._type}, {name: "Message", type: vdl.types.STRING}];
_typeRequest.kind = vdl.kind.STRUCT;
_typeRequest.name = "v.io/v23/vtrace.Request";
_typeRequest.fields = [{name: "SpanId", type: new uniqueid.Id()._type}, {name: "TraceId", type: new uniqueid.Id()._type}, {name: "Flags", type: _typeTraceFlags}, {name: "LogLevel", type: vdl.types.INT32}];
_typeResponse.kind = vdl.kind.STRUCT;
_typeResponse.name = "v.io/v23/vtrace.Response";
_typeResponse.fields = [{name: "Flags", type: _typeTraceFlags}, {name: "Trace", type: _typeTraceRecord}];
_typeSpanRecord.kind = vdl.kind.STRUCT;
_typeSpanRecord.name = "v.io/v23/vtrace.SpanRecord";
_typeSpanRecord.fields = [{name: "Id", type: new uniqueid.Id()._type}, {name: "Parent", type: new uniqueid.Id()._type}, {name: "Name", type: vdl.types.STRING}, {name: "Start", type: new time.Time()._type}, {name: "End", type: new time.Time()._type}, {name: "Annotations", type: _type2}];
_typeTraceFlags.kind = vdl.kind.INT32;
_typeTraceFlags.name = "v.io/v23/vtrace.TraceFlags";
_typeTraceRecord.kind = vdl.kind.STRUCT;
_typeTraceRecord.name = "v.io/v23/vtrace.TraceRecord";
_typeTraceRecord.fields = [{name: "Id", type: new uniqueid.Id()._type}, {name: "Spans", type: _type1}];
_type1.freeze();
_type2.freeze();
_typeAnnotation.freeze();
_typeRequest.freeze();
_typeResponse.freeze();
_typeSpanRecord.freeze();
_typeTraceFlags.freeze();
_typeTraceRecord.freeze();
module.exports.Annotation = (vdl.registry.lookupOrCreateConstructor(_typeAnnotation));
module.exports.Request = (vdl.registry.lookupOrCreateConstructor(_typeRequest));
module.exports.Response = (vdl.registry.lookupOrCreateConstructor(_typeResponse));
module.exports.SpanRecord = (vdl.registry.lookupOrCreateConstructor(_typeSpanRecord));
module.exports.TraceFlags = (vdl.registry.lookupOrCreateConstructor(_typeTraceFlags));
module.exports.TraceRecord = (vdl.registry.lookupOrCreateConstructor(_typeTraceRecord));




// Consts:

  module.exports.Empty = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeTraceFlags))(0, true), _typeTraceFlags);

  module.exports.CollectInMemory = canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeTraceFlags))(1, true), _typeTraceFlags);



// Errors:



// Services:

   
 



},{"../../../../vdl":133,"../../../../vdl/canonicalize":126,"./../uniqueid":54,"./../vdlroot/time":56}],60:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../../../../vdl');





var signature = require('./../../../../../../v23/vdlroot/signature');
var time = require('./../../../../../../v23/vdlroot/time');
var security = require('./../../../../../../v23/security');
var vtrace = require('./../../../../../../v23/vtrace');
var principal = require('./../principal');
var server = require('./../rpc/server');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _type2 = new vdl.Type();
var _type3 = new vdl.Type();
var _type4 = new vdl.Type();
var _type5 = new vdl.Type();
var _type6 = new vdl.Type();
var _type7 = new vdl.Type();
var _type8 = new vdl.Type();
var _type9 = new vdl.Type();
var _typeGranterHandle = new vdl.Type();
var _typeGranterRequest = new vdl.Type();
var _typeGranterResponse = new vdl.Type();
var _typeRpcCallOption = new vdl.Type();
var _typeRpcRequest = new vdl.Type();
var _typeRpcResponse = new vdl.Type();
var _typeRpcServerOption = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = _typeRpcCallOption;
_type2.kind = vdl.kind.LIST;
_type2.name = "";
_type2.elem = new security.BlessingPattern()._type;
_type3.kind = vdl.kind.LIST;
_type3.name = "";
_type3.elem = vdl.types.ANY;
_type4.kind = vdl.kind.LIST;
_type4.name = "";
_type4.elem = _typeRpcServerOption;
_type5.kind = vdl.kind.LIST;
_type5.name = "";
_type5.elem = vdl.types.BYTE;
_type6.kind = vdl.kind.LIST;
_type6.name = "";
_type6.elem = new security.Caveat()._type;
_type7.kind = vdl.kind.LIST;
_type7.name = "";
_type7.elem = vdl.types.STRING;
_type8.kind = vdl.kind.MAP;
_type8.name = "";
_type8.elem = new principal.BlessingsId()._type;
_type8.key = new security.BlessingPattern()._type;
_type9.kind = vdl.kind.LIST;
_type9.name = "";
_type9.elem = new signature.Interface()._type;
_typeGranterHandle.kind = vdl.kind.INT32;
_typeGranterHandle.name = "v.io/x/ref/services/wspr/internal/app.GranterHandle";
_typeGranterRequest.kind = vdl.kind.STRUCT;
_typeGranterRequest.name = "v.io/x/ref/services/wspr/internal/app.GranterRequest";
_typeGranterRequest.fields = [{name: "GranterHandle", type: _typeGranterHandle}, {name: "Call", type: new server.SecurityCall()._type}];
_typeGranterResponse.kind = vdl.kind.STRUCT;
_typeGranterResponse.name = "v.io/x/ref/services/wspr/internal/app.GranterResponse";
_typeGranterResponse.fields = [{name: "Blessings", type: new security.WireBlessings()._type}, {name: "Err", type: vdl.types.ERROR}];
_typeRpcCallOption.kind = vdl.kind.UNION;
_typeRpcCallOption.name = "v.io/x/ref/services/wspr/internal/app.RpcCallOption";
_typeRpcCallOption.fields = [{name: "AllowedServersPolicy", type: _type2}, {name: "RetryTimeout", type: new time.Duration()._type}, {name: "Granter", type: _typeGranterHandle}];
_typeRpcRequest.kind = vdl.kind.STRUCT;
_typeRpcRequest.name = "v.io/x/ref/services/wspr/internal/app.RpcRequest";
_typeRpcRequest.fields = [{name: "Name", type: vdl.types.STRING}, {name: "Method", type: vdl.types.STRING}, {name: "NumInArgs", type: vdl.types.INT32}, {name: "NumOutArgs", type: vdl.types.INT32}, {name: "IsStreaming", type: vdl.types.BOOL}, {name: "Deadline", type: new time.WireDeadline()._type}, {name: "TraceRequest", type: new vtrace.Request()._type}, {name: "Context", type: new server.Context()._type}, {name: "CallOptions", type: _type1}];
_typeRpcResponse.kind = vdl.kind.STRUCT;
_typeRpcResponse.name = "v.io/x/ref/services/wspr/internal/app.RpcResponse";
_typeRpcResponse.fields = [{name: "OutArgs", type: _type3}, {name: "TraceResponse", type: new vtrace.Response()._type}];
_typeRpcServerOption.kind = vdl.kind.UNION;
_typeRpcServerOption.name = "v.io/x/ref/services/wspr/internal/app.RpcServerOption";
_typeRpcServerOption.fields = [{name: "IsLeaf", type: vdl.types.BOOL}, {name: "ServesMountTable", type: vdl.types.BOOL}];
_type1.freeze();
_type2.freeze();
_type3.freeze();
_type4.freeze();
_type5.freeze();
_type6.freeze();
_type7.freeze();
_type8.freeze();
_type9.freeze();
_typeGranterHandle.freeze();
_typeGranterRequest.freeze();
_typeGranterResponse.freeze();
_typeRpcCallOption.freeze();
_typeRpcRequest.freeze();
_typeRpcResponse.freeze();
_typeRpcServerOption.freeze();
module.exports.GranterHandle = (vdl.registry.lookupOrCreateConstructor(_typeGranterHandle));
module.exports.GranterRequest = (vdl.registry.lookupOrCreateConstructor(_typeGranterRequest));
module.exports.GranterResponse = (vdl.registry.lookupOrCreateConstructor(_typeGranterResponse));
module.exports.RpcCallOption = (vdl.registry.lookupOrCreateConstructor(_typeRpcCallOption));
module.exports.RpcRequest = (vdl.registry.lookupOrCreateConstructor(_typeRpcRequest));
module.exports.RpcResponse = (vdl.registry.lookupOrCreateConstructor(_typeRpcResponse));
module.exports.RpcServerOption = (vdl.registry.lookupOrCreateConstructor(_typeRpcServerOption));




// Consts:



// Errors:



// Services:

   

  
    
function Controller(){}
module.exports.Controller = Controller;

    
      
Controller.prototype.newServer = function(ctx, serverCall, name, serverId, serverOpts) {
  throw new Error('Method NewServer not implemented');
};
    
      
Controller.prototype.stop = function(ctx, serverCall, serverId) {
  throw new Error('Method Stop not implemented');
};
    
      
Controller.prototype.addName = function(ctx, serverCall, serverId, name) {
  throw new Error('Method AddName not implemented');
};
    
      
Controller.prototype.removeName = function(ctx, serverCall, serverId, name) {
  throw new Error('Method RemoveName not implemented');
};
    
      
Controller.prototype.bless = function(ctx, serverCall, publicKey, blessings, extension, caveat) {
  throw new Error('Method Bless not implemented');
};
    
      
Controller.prototype.blessSelf = function(ctx, serverCall, name, caveats) {
  throw new Error('Method BlessSelf not implemented');
};
    
      
Controller.prototype.addToRoots = function(ctx, serverCall, blessings) {
  throw new Error('Method AddToRoots not implemented');
};
    
      
Controller.prototype.blessingStoreSet = function(ctx, serverCall, blessingsblessings, pattern) {
  throw new Error('Method BlessingStoreSet not implemented');
};
    
      
Controller.prototype.blessingStoreForPeer = function(ctx, serverCall, peerBlessings) {
  throw new Error('Method BlessingStoreForPeer not implemented');
};
    
      
Controller.prototype.blessingStoreSetDefault = function(ctx, serverCall, blessingsblessings) {
  throw new Error('Method BlessingStoreSetDefault not implemented');
};
    
      
Controller.prototype.blessingStoreDefault = function(ctx, serverCall) {
  throw new Error('Method BlessingStoreDefault not implemented');
};
    
      
Controller.prototype.blessingStorePublicKey = function(ctx, serverCall) {
  throw new Error('Method BlessingStorePublicKey not implemented');
};
    
      
Controller.prototype.blessingStorePeerBlessings = function(ctx, serverCall) {
  throw new Error('Method BlessingStorePeerBlessings not implemented');
};
    
      
Controller.prototype.blessingStoreDebugString = function(ctx, serverCall) {
  throw new Error('Method BlessingStoreDebugString not implemented');
};
    
      
Controller.prototype.remoteBlessings = function(ctx, serverCall, name, method) {
  throw new Error('Method RemoteBlessings not implemented');
};
    
      
Controller.prototype.signature = function(ctx, serverCall, name) {
  throw new Error('Method Signature not implemented');
};
     

    
Controller.prototype._serviceDescription = {
  name: 'Controller',
  pkgPath: 'v.io/x/ref/services/wspr/internal/app',
  doc: "",
  embeds: [],
  methods: [
    
      
    {
    name: 'NewServer',
    doc: "// NewServer instructs WSPR to create a server and start listening for calls on\n// behalf of a JavaScript server.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'serverId',
      doc: "",
      type: vdl.types.UINT32
    },
    {
      name: 'serverOpts',
      doc: "",
      type: _type4
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'Stop',
    doc: "// Stop instructs WSPR to stop listening for calls for the\n// given javascript server.",
    inArgs: [{
      name: 'serverId',
      doc: "",
      type: vdl.types.UINT32
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'AddName',
    doc: "// AddName adds a published name to an existing server.",
    inArgs: [{
      name: 'serverId',
      doc: "",
      type: vdl.types.UINT32
    },
    {
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'RemoveName',
    doc: "// RemoveName removes a published name from an existing server.",
    inArgs: [{
      name: 'serverId',
      doc: "",
      type: vdl.types.UINT32
    },
    {
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'Bless',
    doc: "// Bless binds extensions of blessings held by this principal to\n// another principal (represented by its public key).",
    inArgs: [{
      name: 'publicKey',
      doc: "",
      type: _type5
    },
    {
      name: 'blessings',
      doc: "",
      type: new security.WireBlessings()._type
    },
    {
      name: 'extension',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'caveat',
      doc: "",
      type: _type6
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: new principal.BlessingsId()._type
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessSelf',
    doc: "// BlessSelf creates a blessing with the provided name for this principal.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'caveats',
      doc: "",
      type: _type6
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: new principal.BlessingsId()._type
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'AddToRoots',
    doc: "// AddToRoots adds the provided blessing as a root.",
    inArgs: [{
      name: 'blessings',
      doc: "",
      type: new security.WireBlessings()._type
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessingStoreSet',
    doc: "// BlessingStoreSet puts the specified blessing in the blessing store under the provided pattern.",
    inArgs: [{
      name: 'blessingsblessings',
      doc: "",
      type: new security.WireBlessings()._type
    },
    {
      name: 'pattern',
      doc: "",
      type: new security.BlessingPattern()._type
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: new principal.BlessingsId()._type
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessingStoreForPeer',
    doc: "// BlessingStoreForPeer retrieves the blessings marked for the given peers.",
    inArgs: [{
      name: 'peerBlessings',
      doc: "",
      type: _type7
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: new principal.BlessingsId()._type
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessingStoreSetDefault',
    doc: "// BlessingStoreSetDefault sets the default blessings.",
    inArgs: [{
      name: 'blessingsblessings',
      doc: "",
      type: new security.WireBlessings()._type
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessingStoreDefault',
    doc: "// BlessingStoreDefault fetches the default blessings for the principal of the controller.",
    inArgs: [],
    outArgs: [{
      name: '',
      doc: "",
      type: new principal.BlessingsId()._type
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessingStorePublicKey',
    doc: "// BlessingStorePublicKey fetches the public key of the principal for which this store hosts blessings.",
    inArgs: [],
    outArgs: [{
      name: '',
      doc: "",
      type: _type5
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessingStorePeerBlessings',
    doc: "// BlessingStorePeerBlessings returns all the blessings that the BlessingStore holds.",
    inArgs: [],
    outArgs: [{
      name: '',
      doc: "",
      type: _type8
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'BlessingStoreDebugString',
    doc: "// BlessingStoreDebugString retrieves a debug string describing the state of the blessing store",
    inArgs: [],
    outArgs: [{
      name: '',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'RemoteBlessings',
    doc: "// RemoteBlessings fetches the remote blessings for a given name and method.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'method',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: _type7
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'Signature',
    doc: "// Signature fetches the signature for a given name.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: _type9
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
     
  ]
};

   
 



},{"../../../../../../../../vdl":133,"./../../../../../../v23/security":53,"./../../../../../../v23/vdlroot/signature":55,"./../../../../../../v23/vdlroot/time":56,"./../../../../../../v23/vtrace":59,"./../principal":63,"./../rpc/server":64}],61:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../../../../vdl');
var canonicalize = require('../../../../../../../../vdl/canonicalize');





var vtrace = require('./../../../../../../v23/vtrace');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _typeLogLevel = new vdl.Type();
var _typeLogMessage = new vdl.Type();
var _typeServerRpcReply = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = vdl.types.ANY;
_typeLogLevel.kind = vdl.kind.ENUM;
_typeLogLevel.name = "v.io/x/ref/services/wspr/internal/lib.LogLevel";
_typeLogLevel.labels = ["Info", "Error"];
_typeLogMessage.kind = vdl.kind.STRUCT;
_typeLogMessage.name = "v.io/x/ref/services/wspr/internal/lib.LogMessage";
_typeLogMessage.fields = [{name: "Level", type: _typeLogLevel}, {name: "Message", type: vdl.types.STRING}];
_typeServerRpcReply.kind = vdl.kind.STRUCT;
_typeServerRpcReply.name = "v.io/x/ref/services/wspr/internal/lib.ServerRpcReply";
_typeServerRpcReply.fields = [{name: "Results", type: _type1}, {name: "Err", type: vdl.types.ERROR}, {name: "TraceResponse", type: new vtrace.Response()._type}];
_type1.freeze();
_typeLogLevel.freeze();
_typeLogMessage.freeze();
_typeServerRpcReply.freeze();
module.exports.LogLevel = {
  INFO: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeLogLevel))('Info', true), _typeLogLevel),
  ERROR: canonicalize.reduce(new (vdl.registry.lookupOrCreateConstructor(_typeLogLevel))('Error', true), _typeLogLevel),
};
module.exports.LogMessage = (vdl.registry.lookupOrCreateConstructor(_typeLogMessage));
module.exports.ServerRpcReply = (vdl.registry.lookupOrCreateConstructor(_typeServerRpcReply));




// Consts:



// Errors:



// Services:

   
 



},{"../../../../../../../../vdl":133,"../../../../../../../../vdl/canonicalize":126,"./../../../../../../v23/vtrace":59}],62:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../../../../vdl');





var time = require('./../../../../../../v23/vdlroot/time');
var naming = require('./../../../../../../v23/naming');
var access = require('./../../../../../../v23/security/access');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = vdl.types.STRING;
_type1.freeze();




// Consts:



// Errors:



// Services:

  
    
function Namespace(){}
module.exports.Namespace = Namespace;

    
      
Namespace.prototype.glob = function(ctx, serverCall, pattern) {
  throw new Error('Method Glob not implemented');
};
    
      
Namespace.prototype.mount = function(ctx, serverCall, name, server, ttl, replace) {
  throw new Error('Method Mount not implemented');
};
    
      
Namespace.prototype.unmount = function(ctx, serverCall, name, server) {
  throw new Error('Method Unmount not implemented');
};
    
      
Namespace.prototype.resolve = function(ctx, serverCall, name) {
  throw new Error('Method Resolve not implemented');
};
    
      
Namespace.prototype.resolveToMountTable = function(ctx, serverCall, name) {
  throw new Error('Method ResolveToMountTable not implemented');
};
    
      
Namespace.prototype.flushCacheEntry = function(ctx, serverCall, name) {
  throw new Error('Method FlushCacheEntry not implemented');
};
    
      
Namespace.prototype.disableCache = function(ctx, serverCall, disable) {
  throw new Error('Method DisableCache not implemented');
};
    
      
Namespace.prototype.roots = function(ctx, serverCall) {
  throw new Error('Method Roots not implemented');
};
    
      
Namespace.prototype.setRoots = function(ctx, serverCall, roots) {
  throw new Error('Method SetRoots not implemented');
};
    
      
Namespace.prototype.setPermissions = function(ctx, serverCall, name, perms, version) {
  throw new Error('Method SetPermissions not implemented');
};
    
      
Namespace.prototype.getPermissions = function(ctx, serverCall, name) {
  throw new Error('Method GetPermissions not implemented');
};
    
      
Namespace.prototype.delete = function(ctx, serverCall, name, deleteSubtree) {
  throw new Error('Method Delete not implemented');
};
     

    
Namespace.prototype._serviceDescription = {
  name: 'Namespace',
  pkgPath: 'v.io/x/ref/services/wspr/internal/namespace',
  doc: "",
  embeds: [],
  methods: [
    
      
    {
    name: 'Glob',
    doc: "// Run a glob query and stream the results.",
    inArgs: [{
      name: 'pattern',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: {
      name: '',
      doc: '',
      type: new naming.GlobReply()._type
    },
    tags: []
  },
    
      
    {
    name: 'Mount',
    doc: "// Mount mounts a server under the given name.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'server',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'ttl',
      doc: "",
      type: new time.Duration()._type
    },
    {
      name: 'replace',
      doc: "",
      type: vdl.types.BOOL
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'Unmount',
    doc: "// Unmount removes an existing mount point.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'server',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'Resolve',
    doc: "// Resolve resolves a name to an address.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: _type1
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'ResolveToMountTable',
    doc: "// ResolveToMountTable resolves a name to the address of the mounttable\n// directly hosting it.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: _type1
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'FlushCacheEntry',
    doc: "// FlushCacheEntry removes the namespace cache entry for a given name.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [{
      name: '',
      doc: "",
      type: vdl.types.BOOL
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'DisableCache',
    doc: "// DisableCache disables the naming cache.",
    inArgs: [{
      name: 'disable',
      doc: "",
      type: vdl.types.BOOL
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'Roots',
    doc: "// Roots returns the addresses of the current mounttable roots.",
    inArgs: [],
    outArgs: [{
      name: '',
      doc: "",
      type: _type1
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'SetRoots',
    doc: "// SetRoots sets the current mounttable roots.",
    inArgs: [{
      name: 'roots',
      doc: "",
      type: _type1
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'SetPermissions',
    doc: "// SetPermissions sets the AccessList in a node in a mount table.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'perms',
      doc: "",
      type: new access.Permissions()._type
    },
    {
      name: 'version',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'GetPermissions',
    doc: "// GetPermissions returns the AccessList in a node in a mount table.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    outArgs: [{
      name: 'perms',
      doc: "",
      type: new access.Permissions()._type
    },
    {
      name: 'version',
      doc: "",
      type: vdl.types.STRING
    },
    ],
    inStream: null,
    outStream: null,
    tags: []
  },
    
      
    {
    name: 'Delete',
    doc: "// Delete deletes the name from the mounttable and, if requested, any subtree.",
    inArgs: [{
      name: 'name',
      doc: "",
      type: vdl.types.STRING
    },
    {
      name: 'deleteSubtree',
      doc: "",
      type: vdl.types.BOOL
    },
    ],
    outArgs: [],
    inStream: null,
    outStream: null,
    tags: []
  },
     
  ]
};

   
 



},{"../../../../../../../../vdl":133,"./../../../../../../v23/naming":49,"./../../../../../../v23/security/access":52,"./../../../../../../v23/vdlroot/time":56}],63:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../../../../vdl');





var security = require('./../../../../../../v23/security');

module.exports = {};



// Types:
var _typeBlessingsCacheAddMessage = new vdl.Type();
var _typeBlessingsCacheDeleteMessage = new vdl.Type();
var _typeBlessingsCacheMessage = new vdl.Type();
var _typeBlessingsId = new vdl.Type();
_typeBlessingsCacheAddMessage.kind = vdl.kind.STRUCT;
_typeBlessingsCacheAddMessage.name = "v.io/x/ref/services/wspr/internal/principal.BlessingsCacheAddMessage";
_typeBlessingsCacheAddMessage.fields = [{name: "CacheId", type: _typeBlessingsId}, {name: "Blessings", type: new security.WireBlessings()._type}];
_typeBlessingsCacheDeleteMessage.kind = vdl.kind.STRUCT;
_typeBlessingsCacheDeleteMessage.name = "v.io/x/ref/services/wspr/internal/principal.BlessingsCacheDeleteMessage";
_typeBlessingsCacheDeleteMessage.fields = [{name: "CacheId", type: _typeBlessingsId}, {name: "DeleteAfter", type: vdl.types.UINT32}];
_typeBlessingsCacheMessage.kind = vdl.kind.UNION;
_typeBlessingsCacheMessage.name = "v.io/x/ref/services/wspr/internal/principal.BlessingsCacheMessage";
_typeBlessingsCacheMessage.fields = [{name: "Add", type: _typeBlessingsCacheAddMessage}, {name: "Delete", type: _typeBlessingsCacheDeleteMessage}];
_typeBlessingsId.kind = vdl.kind.UINT32;
_typeBlessingsId.name = "v.io/x/ref/services/wspr/internal/principal.BlessingsId";
_typeBlessingsCacheAddMessage.freeze();
_typeBlessingsCacheDeleteMessage.freeze();
_typeBlessingsCacheMessage.freeze();
_typeBlessingsId.freeze();
module.exports.BlessingsCacheAddMessage = (vdl.registry.lookupOrCreateConstructor(_typeBlessingsCacheAddMessage));
module.exports.BlessingsCacheDeleteMessage = (vdl.registry.lookupOrCreateConstructor(_typeBlessingsCacheDeleteMessage));
module.exports.BlessingsCacheMessage = (vdl.registry.lookupOrCreateConstructor(_typeBlessingsCacheMessage));
module.exports.BlessingsId = (vdl.registry.lookupOrCreateConstructor(_typeBlessingsId));




// Consts:



// Errors:



// Services:

   
 



},{"../../../../../../../../vdl":133,"./../../../../../../v23/security":53}],64:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file was auto-generated by the vanadium vdl tool.
var vdl = require('../../../../../../../../../vdl');
var makeError = require('../../../../../../../../../verror/make-errors');
var actions = require('../../../../../../../../../verror/actions');





var signature = require('./../../../../../../../v23/vdlroot/signature');
var time = require('./../../../../../../../v23/vdlroot/time');
var security = require('./../../../../../../../v23/security');
var vtrace = require('./../../../../../../../v23/vtrace');
var principal = require('./../../principal');

module.exports = {};



// Types:
var _type1 = new vdl.Type();
var _type2 = new vdl.Type();
var _type3 = new vdl.Type();
var _type4 = new vdl.Type();
var _type5 = new vdl.Type();
var _type6 = new vdl.Type();
var _typeAuthReply = new vdl.Type();
var _typeCaveatValidationRequest = new vdl.Type();
var _typeCaveatValidationResponse = new vdl.Type();
var _typeContext = new vdl.Type();
var _typeLookupReply = new vdl.Type();
var _typeSecurityCall = new vdl.Type();
var _typeServerRpcRequest = new vdl.Type();
var _typeServerRpcRequestCall = new vdl.Type();
_type1.kind = vdl.kind.LIST;
_type1.name = "";
_type1.elem = vdl.types.ANY;
_type2.kind = vdl.kind.LIST;
_type2.name = "";
_type2.elem = vdl.types.STRING;
_type3.kind = vdl.kind.LIST;
_type3.name = "";
_type3.elem = _type4;
_type4.kind = vdl.kind.LIST;
_type4.name = "";
_type4.elem = new security.Caveat()._type;
_type5.kind = vdl.kind.LIST;
_type5.name = "";
_type5.elem = vdl.types.ERROR;
_type6.kind = vdl.kind.LIST;
_type6.name = "";
_type6.elem = new signature.Interface()._type;
_typeAuthReply.kind = vdl.kind.STRUCT;
_typeAuthReply.name = "v.io/x/ref/services/wspr/internal/rpc/server.AuthReply";
_typeAuthReply.fields = [{name: "Err", type: vdl.types.ERROR}];
_typeCaveatValidationRequest.kind = vdl.kind.STRUCT;
_typeCaveatValidationRequest.name = "v.io/x/ref/services/wspr/internal/rpc/server.CaveatValidationRequest";
_typeCaveatValidationRequest.fields = [{name: "Call", type: _typeSecurityCall}, {name: "Context", type: _typeContext}, {name: "Cavs", type: _type3}];
_typeCaveatValidationResponse.kind = vdl.kind.STRUCT;
_typeCaveatValidationResponse.name = "v.io/x/ref/services/wspr/internal/rpc/server.CaveatValidationResponse";
_typeCaveatValidationResponse.fields = [{name: "Results", type: _type5}];
_typeContext.kind = vdl.kind.STRUCT;
_typeContext.name = "v.io/x/ref/services/wspr/internal/rpc/server.Context";
_typeContext.fields = [{name: "Language", type: vdl.types.STRING}];
_typeLookupReply.kind = vdl.kind.STRUCT;
_typeLookupReply.name = "v.io/x/ref/services/wspr/internal/rpc/server.LookupReply";
_typeLookupReply.fields = [{name: "Handle", type: vdl.types.INT32}, {name: "HasAuthorizer", type: vdl.types.BOOL}, {name: "HasGlobber", type: vdl.types.BOOL}, {name: "Signature", type: _type6}, {name: "Err", type: vdl.types.ERROR}];
_typeSecurityCall.kind = vdl.kind.STRUCT;
_typeSecurityCall.name = "v.io/x/ref/services/wspr/internal/rpc/server.SecurityCall";
_typeSecurityCall.fields = [{name: "Method", type: vdl.types.STRING}, {name: "Suffix", type: vdl.types.STRING}, {name: "MethodTags", type: _type1}, {name: "LocalBlessings", type: new principal.BlessingsId()._type}, {name: "LocalBlessingStrings", type: _type2}, {name: "RemoteBlessings", type: new principal.BlessingsId()._type}, {name: "RemoteBlessingStrings", type: _type2}, {name: "LocalEndpoint", type: vdl.types.STRING}, {name: "RemoteEndpoint", type: vdl.types.STRING}];
_typeServerRpcRequest.kind = vdl.kind.STRUCT;
_typeServerRpcRequest.name = "v.io/x/ref/services/wspr/internal/rpc/server.ServerRpcRequest";
_typeServerRpcRequest.fields = [{name: "ServerId", type: vdl.types.UINT32}, {name: "Handle", type: vdl.types.INT32}, {name: "Method", type: vdl.types.STRING}, {name: "Args", type: _type1}, {name: "Call", type: _typeServerRpcRequestCall}];
_typeServerRpcRequestCall.kind = vdl.kind.STRUCT;
_typeServerRpcRequestCall.name = "v.io/x/ref/services/wspr/internal/rpc/server.ServerRpcRequestCall";
_typeServerRpcRequestCall.fields = [{name: "SecurityCall", type: _typeSecurityCall}, {name: "Deadline", type: new time.WireDeadline()._type}, {name: "Context", type: _typeContext}, {name: "TraceRequest", type: new vtrace.Request()._type}, {name: "GrantedBlessings", type: new principal.BlessingsId()._type}];
_type1.freeze();
_type2.freeze();
_type3.freeze();
_type4.freeze();
_type5.freeze();
_type6.freeze();
_typeAuthReply.freeze();
_typeCaveatValidationRequest.freeze();
_typeCaveatValidationResponse.freeze();
_typeContext.freeze();
_typeLookupReply.freeze();
_typeSecurityCall.freeze();
_typeServerRpcRequest.freeze();
_typeServerRpcRequestCall.freeze();
module.exports.AuthReply = (vdl.registry.lookupOrCreateConstructor(_typeAuthReply));
module.exports.CaveatValidationRequest = (vdl.registry.lookupOrCreateConstructor(_typeCaveatValidationRequest));
module.exports.CaveatValidationResponse = (vdl.registry.lookupOrCreateConstructor(_typeCaveatValidationResponse));
module.exports.Context = (vdl.registry.lookupOrCreateConstructor(_typeContext));
module.exports.LookupReply = (vdl.registry.lookupOrCreateConstructor(_typeLookupReply));
module.exports.SecurityCall = (vdl.registry.lookupOrCreateConstructor(_typeSecurityCall));
module.exports.ServerRpcRequest = (vdl.registry.lookupOrCreateConstructor(_typeServerRpcRequest));
module.exports.ServerRpcRequestCall = (vdl.registry.lookupOrCreateConstructor(_typeServerRpcRequestCall));




// Consts:



// Errors:

module.exports.CaveatValidationTimeoutError = makeError('v.io/x/ref/services/wspr/internal/rpc/server.CaveatValidationTimeout', actions.NO_RETRY, {
  'en': '{1:}{2:} Caveat validation has timed out',
}, [
]);


module.exports.InvalidValidationResponseFromJavascriptError = makeError('v.io/x/ref/services/wspr/internal/rpc/server.InvalidValidationResponseFromJavascript', actions.NO_RETRY, {
  'en': '{1:}{2:} Invalid validation response from javascript',
}, [
]);


module.exports.ServerStoppedError = makeError('v.io/x/ref/services/wspr/internal/rpc/server.ServerStopped', actions.RETRY_BACKOFF, {
  'en': '{1:}{2:} Server has been stopped',
}, [
]);




// Services:

   
 



},{"../../../../../../../../../vdl":133,"../../../../../../../../../verror/actions":148,"../../../../../../../../../verror/make-errors":152,"./../../../../../../../v23/security":53,"./../../../../../../../v23/vdlroot/signature":55,"./../../../../../../../v23/vdlroot/time":56,"./../../../../../../../v23/vtrace":59,"./../../principal":63}],65:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Defines an invoker to invoke service methods.
 * @private
 */

module.exports = Invoker;

var createSignature = require('../vdl/create-signature');
var isPublicMethod = require('../lib/service-reflection').isPublicMethod;
var verror = require('../gen-vdl/v.io/v23/verror');
var capitalize = require('../vdl/util').capitalize;
var uncapitalize = require('../vdl/util').uncapitalize;
var isCapitalized = require('../vdl/util').isCapitalized;
var format = require('format');
var context = require('../context');
var asyncCall = require('../lib/async-call');
var InspectableFunction = require('../lib/inspectable-function');

// Method signatures for internal methods that are not present in actual
// signatures.
// These signatures are meant to simplify the implementation of invoke
// and may be partial.
var internalMethodSignatures = {
  __glob: {
    name: '__glob',
    outArgs: []
  },
  __globChildren: {
    name: '__globChildren',
    outArgs: []
  }
};

/**
  * Create an invoker.
  * @param {Service} service Service object.
  * @constructor
  * @private
  */
function Invoker(service) {
  if (!(this instanceof Invoker)) {
    return new Invoker(service);
  }

  var invoker = this;

  invoker._service = service;
  invoker._signature = createSignature(service, service._serviceDescription);
  invoker._methods = {};

  // See comment in src/vdl/reflect-signature.js for..in loop
  for (var key in service) { // jshint ignore:line
    if (!isPublicMethod(key, service)) {
      continue;
    }

    if (isCapitalized(key)) {
      throw new Error('Can\'t export capitalized method ' + key);
    }

    var capitalizedMethodName = capitalize(key);
    var method = service[key];

    var inspectableFn = new InspectableFunction(method);
    // Check whether the number of args reported by javascript (method.length)
    // and the number of args retrieved from fn.toString() are the same.
    // This usually differs if the method is a native method.
    if (inspectableFn.names.length !== method.length) {
      throw new Error('Function "' + key + '" can not be inspected. ' +
        'This is usually because it is a native method or bind is used.');
    }

    invoker._methods[capitalizedMethodName] = {
      name: capitalizedMethodName,
      fn: inspectableFn
    };
  }


  var fn;
  if (typeof service.__glob === 'function') {
    fn = new InspectableFunction(service.__glob);
    if (fn.filteredNames.length !== 1 ||
        fn.names.indexOf('$stream') === -1) {
      // TODO(bjornick): Throw a verror of appropriate type.
      throw new Error(
        '__glob needs to take in a string and be streaming');
    }

    this._methods.__glob = {
      name: '__glob',
      fn: fn
    };
  }

  if (typeof service.__globChildren === 'function') {
    fn = new InspectableFunction(service.__globChildren);
    if (fn.filteredNames.length !== 0 ||
        fn.names.indexOf('$stream') === -1 ) {
      // TODO(bjornick): Throw a verror of appropriate type.
      throw new Error(
        '__globChildren needs to take in no args and be streaming');
    }

    this._methods.__globChildren = {
      name: '__globChildren',
      fn: fn
    };
  }
}

Invoker.prototype.hasGlobber = function() {
  return this.hasMethod('__glob') || this.hasMethod('__globChildren');
};

/**
 * Find a method signature corresponding to the named method.
 *
 * @param {String} methodName - The name of the method
 * @return {MethodSignature} The signature of the named method, or null.
 * @private
 */
Invoker.prototype._findMethodSignature = function(methodName) {
  for (var i = 0; i < this._signature.length; i++) {
    var sig = this._signature[i];
    if (sig.methods) {
      for (var m = 0; m < sig.methods.length; m++) {
        var method = sig.methods[m];
        if (method.name === methodName) {
          return method;
        }
      }
    }
  }
  return null;
};

/**
 * Invoker.prototype.invoke - Invoke a method
 *
 * @param  {String} name - The upper camel case name of the method to invoke.
 * @param  {Array} args - A list of arguments to call the method with, may
 * differ because of injections e.g. function x(a,$stream,b) => [0, 2].
 * @param  {Object} injections - A map of injections, should always
 * contain `context`, could also contain `stream`
 * e.g. function(ctx, x, $stream, b)
 * @param  {Invoker~invokeCallback} cb - The callback fired after completion.
 */
Invoker.prototype.invoke = function(name, args, injections, cb) {
  // TODO(jasoncampbell): Maybe throw if there are unkown injections

  var message;
  var err;

  var invoker = this;
  var method = invoker._methods[name];
  var errorContext = injections.context || new context.Context();
  if (!method) {
    message = format('Method "%s"', name);
    err = new verror.NoExistError(errorContext, message);

    cb(err);
    return;
  }
  var methodSig = this._findMethodSignature(name) ||
    internalMethodSignatures[name];
  if (!methodSig) {
    cb(verror.InternalError(errorContext,
                            'Missing method signature for method ' + name));
  }

  if (!injections.context) {
    message = 'Can not call invoker.invoke(...) without a context injection';
    err = verror.InternalError(errorContext, message);
    cb(err);
    return;
  }

  var arity = method.fn.arity();

  // Check argument arity against the method's declared arity
  if (args.length !== arity) {
    var template = 'Expected %d arguments but got "%s"';

    message = format(template, arity, args.join(', '));
    err = new verror.BadArgError(errorContext, message);
    cb(err);
    return;
  }

  // Clone the array so we can simply manipulate and apply later
  var clonedArgs = args.slice(0);

  // call and context go in front
  clonedArgs.unshift(injections.call);
  clonedArgs.unshift(injections.context);

  // splice in stream
  if (injections.stream) {
    var start = method.fn.position('$stream');
    var deleteCount = 0;

    clonedArgs.splice(start, deleteCount, injections.stream);
  }

  asyncCall(injections.context, invoker._service, method.fn,
    methodSig.outArgs.map(function(outArg) {
      var name = outArg.name;
      return name ? uncapitalize(name) : '_';
    }), clonedArgs, cb);
};

/**
 * This callback is fired on completion of invoker.invoke.
 * @callback Invoker~invokeCallback
 * @param {Error} err
 * @param {results} results
 */

/**
 * Return the signature of the service.
 * @return {Object} The signature
 */
Invoker.prototype.signature = function() {
  return this._signature;
};


/**
 * returns whether the function <name> is invokable.
 * @param {string} name the name of the function
 * @return {boolean} whether the function is invokable.
 */
Invoker.prototype.hasMethod = function(name) {
  return !!this._methods[name];
};

},{"../context":48,"../gen-vdl/v.io/v23/verror":57,"../lib/async-call":67,"../lib/inspectable-function":72,"../lib/service-reflection":75,"../vdl/create-signature":129,"../vdl/util":147,"format":31}],66:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * Arguments inspector module
 * @module vanadium/src/lib/arg-inspector
 * @private
 */
module.exports = ArgumentInspector;

/**
 * ArgumentInspector - Creates a helper object for inspecting a functions
 * arguments
 *
 * @constructor
 * @param  {Function} fn The function whose arguments need to be inspected.
 * @return {ArgumentInspector} The ArgumentInspector instance.
 */
function ArgumentInspector(fn) {
  if (!(this instanceof ArgumentInspector)) {
    return new ArgumentInspector(fn);
  }

  var inspector = this;
  // Get the original array of argument names from the function.
  var names = getArgumentNamesFromFunction(fn);

  inspector.names = names;
  inspector.filteredNames = filter(names);
}

/**
 * ArgumentInspector.prototype.position - Returns the position of an
 * argument name in the original `inspector.names` list.
 *
 * @param {String} Name of the argument being tested.
 * @returns {Integer} Position of the argument name.
 */
ArgumentInspector.prototype.position = function(name) {
  return this.names.indexOf(name);
};

/**
 * ArgumentInspector.prototype.contains - Helper that returns a Boolean value
 * to check wether or not the `name` is in the `inspector.names` list of
 * original argument names.
 *
 * @param {String} Name of the argument being tested.
 */
ArgumentInspector.prototype.contains = function(name) {
  return this.position(name) >= 0;
};


/**
 * ArgumentInspector.prototype.hasContext - Helper to know if a context is in
 * the argument list and is in the right position.
 *
 * @return {Boolean} Wether or not the
 */
ArgumentInspector.prototype.hasContext = function() {
  var hasCtx = this.contains('ctx') && this.position('ctx') === 0;
  var hasContext = this.contains('context') && this.position('context') === 0;

  return hasCtx || hasContext;
};

/**
 * Helper to know if a call is in the argument position and is in the right
 * position.
 */
ArgumentInspector.prototype.hasCall = function() {
  return this.contains('serverCall') && this.position('serverCall') === 1;
};

/**
 * ArgumentInspector.prototype.hasCallback - Helper to know if a context is in
 * the argument list and is in the right position.
 *
 * @return {Boolean} Wether or not the
 */
ArgumentInspector.prototype.hasCallback = function() {
  var lastIndex = this.names.length - 1;
  var hasCb = this.contains('cb') && this.position('cb') === lastIndex;
  var hasCallback = this.contains('callback') &&
    this.position('callback') === lastIndex;

  return hasCb || hasCallback;
};

/**
 * ArgumentInspector.prototype.arity - Returns the inspected arguments airty
 * sans context and callback.
 *
 * @return {type}  description
 */
ArgumentInspector.prototype.arity = function() {
  var args = this;

  return args.filteredNames.length;
};

/**
 * Returns an array of argument names for a function.
 * from go/fypon (stack overflow) and based on angularjs's implementation
 * @param {function} func the function object
 * @return {string[]} list of the arguments
 */
function getArgumentNamesFromFunction(func) {
  var fnStr = func.toString().replace(/((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg, '');

  // get the arguments from the string
  var result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')'))
    .match(/([^\s,]+)/g);

  if (!result) {
    result = [];
  }

  return result;
}

/**
 * filter - Returns an array of filtered argument
 * names that has been scrubbed for the first argument named context/ctx, the
 * last argument named callback/cb, and a potentially randomly injected
 * $stream argument.
 *
 * @param  {Array} names - An array of string names to filter
 * @retrun {Array} filtered array of names.
 */
function filter(names) {
  // clone the arg names
  var results = names.slice(0);
  var first = results[0];
  var last = results[results.length - 1];

  // Filter $stream wherever it lives
  var position = names.indexOf('$stream');

  if (position >= 0) {
    var deleteCount = 1;

    results.splice(position, deleteCount);
  }

  // only filter ctx/context if it is the first argument
  if (first === 'ctx' || first === 'context') {
    results.shift();
  }

  if (results[0] === 'serverCall') {
    results.shift();
  }
  // only filter cb/callback if it is the last
  if (last === 'cb' || last === 'callback') {
    results.pop();
  }

  return results;
}

},{}],67:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file defines a async calling convention intended used to call
// user-defined functions.

var logger = require('../lib/vlog').logger;
var makeError = require('../verror/make-errors');
var actions = require('../verror/actions');

module.exports = asyncCall;

var IncorrectResultCountError = makeError(
  'v.io/core/javascript.IncorrectResultCount',
  actions.NO_RETRY,
  '{1:}{2:} IncorrectResultCount: Expected {3} results, but got {4}{:_}');
/**
 * asyncCall performs a call and calls a callback with the result.
 *
 * The called function must either return a promise or call a callback and
 * return undefined.
 *
 * @private
 * @param {Context} ctx Context
 * @param {*} self The object to be "this" during invocation.
 * @param {InspectableFunction} fn The function
 * @param {Array} outArgs The names of the expected output arguments
 * @param {*} args The argument values
 * @param {Function} inputCb callback when finished
 * @return {type} Promise or undefined
 */
function asyncCall(ctx, self, fn, outArgs, args, inputCb) {
  var cbCalled;
  var numOutArgs = outArgs.length;
  // Helper to call the callback once
  function callOnceCb(err, results) {
    if (cbCalled) {
      logger.error('Callback called multiple times');
      return;
    }
    inputCb.apply(self, arguments);
    cbCalled = true;
  }
  function handleResult(err, res) {
    if (err) {
      // Error case
      return callOnceCb(err);
    }
    // Results case
    var numResults = res.length;
    if (numResults === numOutArgs) {
      // Correct number of out args given
      return callOnceCb(null, res);
    }
    // Internal error: incorrect number of out args
    err = new IncorrectResultCountError(ctx, numOutArgs, numResults);
    logger.error(err);
    callOnceCb(err);
  }
  // Callback we are injecting into the user's function
  function injectedCb(err /*, args */) {
    handleResult(err, Array.prototype.slice.call(arguments, 1));
  }

  if (fn.hasCallback()) {
    args.push(injectedCb);
  }

  var result;
  try {
    result = fn.apply(self, args);
  } catch (err) {
    logger.error('Caught error: ', err);
    callOnceCb(wrapError(err));
    return;
  }

  // Callback case (wait for callback to be called directly):
  if (fn.hasCallback()) {
    return;
  }

  // Promise / direct return case:
  Promise.resolve(result).then(function(res) {
    // We expect:
    // 0 args - return; // NOT return [];
    // 1 args - return a; // NOT return [a];
    // 2 args - return [a, b] ;
    //
    // Convert the results to always be in array style:
    // [], [a], [a, b], etc
    // Note that the arity checking isn't done here, but at a later point
    // sharing the logic between the callback and promise case.
    switch (numOutArgs) {
      case 0:
        if (res !== undefined) {
          return Promise.reject(
            new IncorrectResultCountError(ctx, 0, 1,
                                          'expected undefined result ' +
                                          'for void function'));
        }
        return [];
      case 1:
        // Note: If res is undefined, the result is [undefined].
        return [res];
      default:
        if (!Array.isArray(res)) {
          return Promise.reject(
            new IncorrectResultCountError(ctx, numOutArgs, 1));
        }
        return res;
    }
  }).then(function(res) {
    handleResult(null, res);
  }).catch(function(err) {
    handleResult(wrapError(err));
  });
}

/**
 * Wrap an error so that it is always of type Error.
 * This is used in cases where values are known to be errors even if they
 * are not of error type such as if they are thrown or rejected.
 * @private
 * @param {*} err The error or other value.
 * @return {Error} An error or type Error.
 */
function wrapError(err) {
  if (err instanceof Error) {
    return err;
  }
  return new Error(err);
}

},{"../lib/vlog":79,"../verror/actions":148,"../verror/make-errors":152}],68:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


module.exports.promiseFor = promiseFor;
module.exports.promiseWhile = promiseWhile;

var Promise = require('./promise');

/**
 * promiseFor performs an asynchronous body n times.
 * @param {number} n The number of times to call body
 * @param {function} body The body to run. It should return
 * a promise that will be resolved when it is done
 * @return {Promise} A promise that will resolve when the body has
 * been run n times.
 * @private
 */
function promiseFor(n, body) {
  if (n === 0) {
    return Promise.resolve();
  }
  function doStep() {
    n--;
    if (n === 0) {
      return Promise.resolve();
    }
    return body().then(doStep);
  }

  return body().then(doStep);
}
/**
 * promiseWhile performs an asynchronous body as long as an async predict
 * is true.
 * @param {function} predicate A function that returns a Promise<bool> that
 * says whether the body should be run or not.
 * @param {function} body A function that returns a Promise that will be
 * resolved once the body is done executing.
 * @return {Promise} A promise that will be resolved once the while is done.
 * @private
 */

function promiseWhile(predicate, body) {
  return predicate().then(function(success) {
    if (!success) {
      return Promise.resolve();
    }
    return body().then(function() {
      return promiseWhile(predicate, body);
    });
  });
}

},{"./promise":73}],69:[function(require,module,exports){
(function (process){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview A lightweight deferred implementation built on promises.
 *
 * A deferred encapsulates a promise and its resolve/reject methods in a single
 * object.  This makes deferreds easier to pass to around and resolve or reject
 * from other pieces of code.
 * @private
 */

var Promise = require('./promise');

module.exports = Deferred;

function Deferred(cb) {
  var deferred = this;

  deferred.promise = new Promise(function(resolve, reject) {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  addCallback(deferred.promise, cb);
}

function addCallback(promise, cb) {
  if (cb) {
    promise.then(
      function success(value) {
        cb(null, value);
      },
      function error(err) {
        cb(err);
      }
    ).catch(function catchError(err) {
      // Re-throw the error in a process.nextTick so that it won't be caught by
      // the promise implementation.
      process.nextTick(function() {
        throw err;
      });
    });
  }
}

// This adds a callback to the deferred (for people using the callback api).
Deferred.prototype.addCallback = function(cb) {
  addCallback(this.promise, cb);
};

}).call(this,require('_process'))
},{"./promise":73,"_process":11}],70:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var vlog = require('./vlog');

module.exports = emitStreamError;

/*
 * Emits an error event on an stream object.
 * NOTE: nodejs streams throw an exception on emit(error) if stream does
 * not have at least one error handler attached to it.
 * Therefore we won't emit error if there is no handler and show a warn message.
 * See http://goo.gl/4hnDCh for details.
 */
function emitStreamError(stream, err) {
  if (!stream) {
    return;
  }
  if(stream.listeners('error').length === 0) {
    vlog.logger.warn('Error received on a stream but there are no error ' +
          'handlers attached to the stream', err);
  } else {
    stream.emit('error', err);
  }
}

},{"./vlog":79}],71:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @private
 * @fileoverview Helper methods for vom and hex encode/decode.
 */

var byteUtil = require('../vdl/byte-util');
var vom = require('../vom');

module.exports = {
  decode: decode,
  encode: encode
};

function encode(x, t, typeEnc) {
  return byteUtil.bytes2Hex(vom.encode(x, t, typeEnc));
}

function decode(x) {
  return vom.decode(byteUtil.hex2Bytes(x));
}

},{"../vdl/byte-util":125,"../vom":165}],72:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// This file defines a helper to call a function and introspect its metadata.
// It allows us to pass a function around with its precomputed ArgInspector
// metadata.

module.exports = InspectableFunction;

var ArgInspector = require('../lib/arg-inspector');
var inherits = require('inherits');

/**
 * InspectableFunction represents an invocable function with extra metadata.
 * @private
 * @constructor
 * @param {Function} fn The function
 */
function InspectableFunction(fn) {
  this.fn = fn;
  ArgInspector.apply(this, arguments);
  Object.freeze(this);
}

inherits(InspectableFunction, ArgInspector);

/**
 * Call the function represented by InspectableFunction.
 * Args and return value are the same as Function.apply.
 * @private
 */
InspectableFunction.prototype.apply = function(self, args) {
  return this.fn.apply(self, args);
};

},{"../lib/arg-inspector":66,"inherits":32}],73:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Vanadium.js promise implementation.
 *
 * This uses the native Promise implementation in browsers, and the es6-promise
 * polyfill in non-browsers.
 *
 * WARNING: es6 promises are notorius for eating errors. Make sure to add
 * 'catch()' to the end of promise chains so that errors can be caught and
 * handled.
 *
 * See for reference:
 *   http://blog.soareschen.com/the-problem-with-es6-promises
 *   https://github.com/soareschen/es6-promise-debugging
 *   https://github.com/petkaantonov/bluebird#error-handling
 *
 * @private
 */

var isBrowser = require('is-browser');

if (isBrowser) {
  // Use native Promise implementation in browsers.
  if (typeof Promise === 'undefined') {
    throw new Error('No native promise implementation found.');
  }
  module.exports = Promise;
} else {
  // Use es6-promise polyfill in non-browsers.
  // The require string is split so that browserify does not bundle es6-promise
  // library.
  module.exports = require('es6' + '-promise').Promise;
}

},{"is-browser":33}],74:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Helper functions to get random values.
 * @private
 */

// This will use window.crypto in browser, and node's crypto library in node.
var randomBytes = require('randombytes');

module.exports = {
  int32: int32,
  hex: hex
};

function int32() {
  return randomBytes(4).readInt32BE(0);
}

function hex(len) {
  len = len || 16;
  return randomBytes(Math.ceil(len/2)).toString('hex').substr(0, len);
}

},{"randombytes":39}],75:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Helpers for performing reflection on user-defined services
 * in a consistent way.
 * @private
 */

module.exports = {
  isPublicMethod: isPublicMethod
};

/**
 * isPublicMethod - Test wether a key on a service object is a valid method
 * that should be refelcetd.
 * @private
 * @param  {String} key - The attribute key to test on the service object.
 * @param  {Object} service - The service object.
 * @return {Boolean} valid - Wether or not the method should be reflected.
 */
function isPublicMethod(key, service) {
  // Not a valid method name if key is falsey (length 0, null, etc.)
  if (!key) {
    return false;
  }

  var isPrefixed = key[0] === '_';
  var isFunction = typeof service[key] === 'function';

  return !isPrefixed && isFunction;
}

},{}],76:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

module.exports = TaskSequence;

var vlog = require('./vlog');
var Promise = require('../lib/promise');
/**
 * A sequencer of async operations that need to happen synchronously. The
 * queue will be processes in a FIFO order and only one operation will be
 * outstanding at a time.  This library uses Promises in the API instead of
 * callbacks since setImmediate isn't implemented in Chrome, causing nextTick
 * calls to take at least a millisecond.
 * @constructor
 * @private
 */
function TaskSequence() {
  this._lastPromise = Promise.resolve();
}

/**
 * Adds a task to a queue.
 * @param {function} task The task to run.  It should return a promise that
 * will be resolved/rejected on completion of the task.
 */
TaskSequence.prototype.addTask = function(task) {
  this._lastPromise = this._lastPromise.then(function() {
    return task();
  }).catch(function(err) {
    vlog.logger.error('Task failed with ' + err.stack);
  });
};

},{"../lib/promise":73,"./vlog":79}],77:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview A package to generate uniqueids based on random numbers.
 *
 * @private
 */

/**
 * @summary Namespace uniqueId defines functions that are likely to generate
 * globally unique identifiers.
 * @description <p>Namespace uniqueId defines functions that are likely to
 * generate globally unique identifiers. We want to be able to generate many
 * Ids quickly, so we make a time/space tradeoff. We reuse the same random data
 * many times with a counter appended. Note: these Ids are NOT useful as a
 * security mechanism as they will be predictable.</p>
 * @namespace
 * @name uniqueId
 * @memberof module:vanadium
 */

var typeutil = require('../vdl/type-util');
var vdl = require('../gen-vdl/v.io/v23/uniqueid');
var byteUtil = require('../vdl/byte-util');

var currentRandom;
var currentSequence = 0;

/**
 * Generate a new random uniqueId.Id.
 * @return {module:vanadium.uniqueId.Id} A new random uniqueId.Id.
 * @memberof module:vanadium.uniqueId
 */
function random() {
  var out = new vdl.Id();
  var val = typeutil.unwrap(out);

  if (currentSequence === 0) {
    currentRandom = new Uint8Array(14);
    for (var j = 0; j < 14; j++) {
      currentRandom[j] = Math.floor(Math.random() * 256);
    }
  }
  for (var i = 0; i < 14; i++) {
    val[i] = currentRandom[i];
  }
  val[14] = ((currentSequence >> 8) & 0x7f) | 0x80;
  val[15] = currentSequence & 0xff;
  currentSequence = (currentSequence + 1) & 0x7fff;
  return out;
}

/**
 * Returns true iff the given uniqueid.Id is valid.
 * @param {module:vanadium.uniqueId.Id} A uniqueId.Id instance.
 * @return {boolean} true if the given uniqueId.Id is valid.
 * @memberof module:vanadium.uniqueId
 */
function valid(id) {
  id = typeutil.unwrap(id);
  if (!id || id.length < 16) {
    return false;
  }
  for (var i = 0; i < 16; i++) {
    if (id[i] !== 0) {
      return true;
    }
  }
  return false;
}

/**
 * Returns a hexidecimal string representation of the given uniqueid.Id.
 * @param {module:vanadium.uniqueId.Id} id A uniqueId.Id instance.
 * @return {string} A hexidecimal string.
 * @memberof module:vanadium.uniqueId
 */
function toHexString(id) {
  return byteUtil.bytes2Hex(typeutil.unwrap(id));
}

/**
 * Creates a uniqeid.Id instance from its hexidecimal string representation.
 * @param {string} s A hexidecimal string.
 * @return {module:vanadium.uniqueId.Id} A uniqueId.Id instance.
 * @memberof module:vanadium.uniqueId
 */
function fromHexString(s) {
  return new vdl.Id(byteUtil.hex2Bytes(s));
}

module.exports = {
  random: random,
  valid: valid,
  toHexString: toHexString,
  fromHexString: fromHexString,
  /**
   * @summary An Id is a likely globally unique identifier.
   * @description
   * <p>Use [random]{@link module:vanadium.uniqueId.random} to
   * create a new one.</p>
   * @property {Uint8array} val 16-byte array.
   * @name Id
   * @param {Uint8Array} bytes 16-byte array.
   * @constructor
   * @memberof module:vanadium.uniqueId
   */
  Id: vdl
};

},{"../gen-vdl/v.io/v23/uniqueid":54,"../vdl/byte-util":125,"../vdl/type-util":144}],78:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var unwrap = require('../vdl/type-util').unwrap;
var kind = require('../vdl/kind');

module.exports = unwrapArg;

/**
 * Unwrap decoded value into the format expected for args.
 * Specifically, the outermost layer is unwrapped iff the target
 * type is not any.
 * @private
 * @param {*} arg The argument.
 * @param {Type} targetType The VDL type for the argument.
 * @return {*} either arg or an unwrapped arg.
 */
function unwrapArg(arg, targetType) {
    if (targetType.kind === kind.ANY) {
      return arg;
    }
    return unwrap(arg);
}

},{"../vdl/kind":136,"../vdl/type-util":144}],79:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @summary Namespace vlog defines and implements logging interfaces.
 * @description
 * <p>Namespace vlog defines and implements logging interfaces.</p>
 *
 * @namespace
 * @name vlog
 * @memberof module:vanadium
*/

var extend = require('xtend');
/**
 * @namespace
 * @summary Namespace levels defines the log levels used to configure the
 * vanadium logger.
 * @description Namespace levels defines the log levels used to configure the
 * vanadium logger.
 * @memberof module:vanadium.vlog
 */
var levels = {
  /**
   * No logs are written.
   * @const
   */
  NOLOG: 0,
  /**
   * Only errors are written.
   * @const
   */
  ERROR : 1,
  /**
   * Only errors and warnings are written.
   * @const
   */
  WARN: 2,
  /**
   * Errors, warnings, and debug messages are written.
   * @const
   */
  DEBUG : 3,
  /**
   * All logs are written.
   * @const
   */
  INFO : 4
};
var defaults = {
  level: levels.NOLOG, // Typically set through the default in vanadium.js
  console: console
};

/**
 * @summary Private Constructor. Use
 * [vanadium.vlog.logger]{@link module:vanadium.vlog.logger} as an instance.
 *
 * @memberof module:vanadium.vlog
 * @constructor
 * @inner
 */
var Vlog = function(options) {
  if (!(this instanceof Vlog)) { return new Vlog(options); }

  var vlog = this;

  options = extend(defaults, options);

  vlog.level = options.level;
  vlog.console = options.console;
};

/**
 * Logs arguments as errors to the console if log level is error or higher.
 * @param {...*} values The values to log.
 */
Vlog.prototype.error = function() {
  this._log(levels.ERROR, arguments);
};

/**
 * Logs arguments as warnings to the console if log level is warning or higher.
 * @param {...*} values The values to log.
 */
Vlog.prototype.warn = function() {
  this._log(levels.WARN, arguments);
};

/**
 * Logs arguments as logs to the console if log level is debug or higher.
 * @param {...*} values The values to log.
 */
Vlog.prototype.debug = function() {
  this._log(levels.DEBUG, arguments);
};

/**
 * Logs arguments as info to the console if log level is info or higher.
 * @param {...*} values The values to log.
 */
Vlog.prototype.info = function() {
  this._log(levels.INFO, arguments);
};

Vlog.prototype._log = function(level, args) {
  if (this.level >= level) {
    this._write(level, args);
  }
};

Vlog.prototype._write = function(level, args) {
  var vlog = this;
  var method;

  if (! vlog.console) {
    return;
  }

  switch (level) {
    case levels.ERROR:
      method = vlog.console.error;
      break;
    case levels.WARN:
      method = vlog.console.warn;
      break;
    case levels.DEBUG:
      method = vlog.console.log;
      break;
    case levels.INFO:
      method = vlog.console.info;
      break;
    default:
      method = vlog.console.log;
      break;
  }

  method.apply(vlog.console, args);
};

module.exports = {
  /**
   * Default logger instance.
   * @memberof module:vanadium.vlog
   * @type {module:vanadium.vlog~Vlog}
   */
  logger: new Vlog(),
  Vlog: Vlog,
  levels: levels
};

},{"xtend":41}],80:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

 /**
  * @summary Namespace naming defines the public interface for naming, including
  * the format of names, the APIs for manipulating the name as
  * well as all associated types for resolving, globbing and managing names.
  *
  * @description
  * <p>Namespace naming defines the public interface for naming, including
  * the format of names, the APIs for manipulating the name as
  * well as all associated types for resolving, globbing and managing names.</p>
  *
  * <p>Object names are 'resolved' using a MountTable to obtain a
  * MountedServer that RPC method invocations can be directed
  * at. MountTables may be mounted on each other to typically create a
  * hierarchy. The name resolution process can thus involve multiple
  * MountTables. Although it is expected that a hierarchy will be the
  * typical use, it is nonetheless possible to create a cyclic graph of
  * MountTables which will lead to name resolution errors at runtime.</p>
  *
  * <p>Object names are strings with / used to separate the components of
  * a name.  Names may be started with / and the address of a
  * MountTable or server, in which case they are considered 'rooted',
  * otherwise they are 'relative' to the MountTable used to resolve
  * them. Rooted names, unlike relative ones, have the same meaning
  * regardless of the context in which they are accessed.</p>
  *
  * <p>The first component of a rooted name is the address of the
  * MountTable to use for resolving the remaining components of the
  * name. The address may be the string representation of an Endpoint,
  * a &lt;host&gt;:&lt;port&gt;, or &lt;ip&gt;:&lt;port&gt;. In addition,
  * &lt;host&gt; or &lt;ip&gt; may be used without a &lt;port&gt; being
  * specified in which case a default port is used. The portion of the name
  * following the address is a relative name.</p>
  * <br>
  * Thus:
  * <br>
  * /host:port/a/b/c/d means starting at host:port resolve a/b/c/d and
  * return the terminating server and the relative path from that
  * server.
  *
  * @namespace
  * @name naming
  * @memberof module:vanadium
  */

var extend = require('xtend');

module.exports = extend(
  require('../gen-vdl/v.io/v23/naming'),
  require('./util')
);

},{"../gen-vdl/v.io/v23/naming":49,"./util":82,"xtend":41}],81:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var vdl = require('../gen-vdl/v.io/x/ref/services/wspr/internal/namespace');
var time = require('../gen-vdl/v.io/v23/vdlroot/time');
var emitStreamError = require('../lib/emit-stream-error');
var Readable = require('stream').Readable;
var inherits = require('util').inherits;

module.exports = Namespace;

/**
 * @summary
 * Namespace defines the APIs for resolving, globbing and managing names.
 *
 * @description
 * <p>Private Constructor. Use
 * [runtime.namespace]{@link module:vanadium~Runtime#namespace} to get an
 * instance.</p>
 *
 * @constructor
 * @inner
 * @memberof module:vanadium.naming
 */
function Namespace(client, rootCtx) {
  this._namespace = client.bindWithSignature(
    '__namespace', [vdl.Namespace.prototype._serviceDescription]);
  this._rootCtx = rootCtx;
}

function GlobStream(orig) {
  Readable.call(this, {objectMode: true});
  this._orig = orig;

  var stream = this;
  orig.on('end', function() {
    if (!stream._flow(true)) {
      orig.on('writable', stream._flow.bind(stream, true));
    }
  });
  orig.on('readable', stream._flow.bind(stream, false));

  stream._flow(false);
}

inherits(GlobStream, Readable);

GlobStream.prototype._flow = function(drain) {
  // We split the GlobReply union type and send GlobErrors through the
  // stream's error channel and valid MountPoints through the data channel.
  var chunk;
  while((chunk = this._orig.read()) !== null) {
    if (chunk.entry) {
      if (!this.push(chunk.entry)) {
        return false;
      }
    } else if (chunk.error) {
      emitStreamError(this, chunk.error);
    }
  }
  if (drain) {
    this.push(null);
  }
  return true;
};

GlobStream.prototype._read = function() {
  // We don't need to do anything, we're always trying to read.
};

/**
 * Glob streams all names matching pattern. If recursive is true, it also
 * returns all names below the matching ones.
 * @param {module:vanadium.context.Context} ctx The rpc context.
 * @param {string} pattern Glob pattern to match
 * @param {function} cb(error) Optional callback
 * @return {Promise} A promise with an stream object hanging from it.
 */
Namespace.prototype.glob = function(ctx, pattern, cb) {
  var promise = this._namespace.glob(ctx, pattern, cb);

  // We get back a single stream of errors and entries,
  // we now split them into a separate stream of errors and
  // data via a transform stream.
  var newPromise = Promise.resolve(promise);
  newPromise.stream = new GlobStream(promise.stream);
  return newPromise;
};

/**
 * Mount the server object address under the object name, expiring after
 * @param {module:vanadium.context.Context} ctx The rpc context.
 * @param {string} name Object name
 * @param {string} server Server object address
 * @param {number} ttl Expiry time for the mount in milliseconds. ttl of zero
 * implies never expire.
 * @param {boolean} [replaceMount] Whether the previous mount should
 * be replaced by the new server object address. False by default.
 * @param {function} cb(error) Optional callback
 * @return {Promise} A promise to be resolved when mount is complete or rejected
 * when there is an error
 */
Namespace.prototype.mount = function(ctx, name, server, ttl, replaceMount,
                                     cb) {
  ttl = ttl || 0; // Default is 0
  var duration = new time.Duration({
    seconds: Math.floor(ttl / 1000),
    nanos: (ttl % 1000) * 1000000
  });
  replaceMount = !!replaceMount; // Cast to bool
  return this._namespace.mount(ctx, name, server, duration, replaceMount, cb);
};

/**
 * Unmount the server object address from the object name, or if server is empty
 * unmount all server object address from the object name.
 * @param {module:vanadium.context.Context} ctx The rpc context.
 * @param {string} name Object name
 * @param {string} server Server object address
 * @param {function} cb(error) Optional callback
 * @return {Promise} A promise to be resolved when unmount is complete or
 * rejected when there is an error
 */
Namespace.prototype.unmount = function(ctx, name, server, cb) {
  return this._namespace.unmount(ctx, name, server, cb);
};

/**
 * Resolve the object name into its mounted servers.
 * @param {module:vanadium.context.Context} ctx The rpc context
 * @param {string} name Object name
 * @param {function} cb(error, string[]) Optional callback
 * @return {Promise<string[]>} A promise to be resolved a string array of server
 * object object addresses or rejected when there is an error
 */
Namespace.prototype.resolve = function(ctx, name, cb) {
  return this._namespace.resolve(ctx, name, cb);
};

/**
 * ResolveToMountTable resolves the object name into the mounttables
 * directly responsible for the name.
 * @param {module:vanadium.context.Context} ctx The rpc context.
 * @param {string} name Object name
 * @param {function} cb(error, string[]) Optional callback
 * @return {Promise<string[]>} A promise to be resolved a string array of
 * mounttable object addresses or rejected when there is an error
 */
Namespace.prototype.resolveToMounttable = function(ctx, name, cb) {
  return this._namespace.resolveToMountTable(ctx, name, cb);
};

/*
 * FlushCacheEntry flushes resolution information cached for the name.
 * @param {string} name Object name
 * @param {function} cb(error, boolean) Optional callback
 * @return {Promise<boolean>} A promise to be resolved a boolean indicating if
 * anything was flushed or rejected when there is an error
 */
Namespace.prototype.flushCacheEntry = function(name, cb) {
  return this._namespace.flushCacheEntry(this._rootCtx, name, cb);
};

/*
 * Disables the resolution cache when set to true and enables if false.
 * @param {boolean} disable Whether to disable or enable cache.
 * @param {function} cb(error) Optional callback
 * @return {Promise} A promise to be resolved when disableCache is complete or
 * rejected when there is an error
 */
Namespace.prototype.disableCache = function(disable, cb) {
  disable = !!disable; // Cast to bool
  return this._namespace.disableCache(this._rootCtx, disable, cb);
};

/**
 * Returns the currently configured roots. An empty array is returned if no
 * roots are configured.
 * @param {function} cb(error, string[]) Optional callback
 * @return {Promise<string[]>} A promise to be resolved with an array of root
 * object names when getRoots is complete or rejected when there is an error
 */
Namespace.prototype.roots = function(cb) {
  return this._namespace.roots(this._rootCtx, cb);
};

/**
 * Sets the roots that the local Namespace is relative to.
 * All relative names passed to the methods above will be interpreted as
 * relative to these roots.
 * The roots will be tried in the order that they are specified in the parameter
 * list for setRoots.
 * @param {...string} roots object names for the roots
 * @param {function} cb(error) Optional callback
 * @return {Promise} A promise to be resolved when setRoots is complete or
 * rejected when there is an error
 */
Namespace.prototype.setRoots = function(roots, cb) {
  if (!Array.isArray(roots)) {
    roots = Array.prototype.slice.call(arguments);
    if (typeof roots[roots.length - 1] === 'function') {
      cb = roots.pop();
    } else {
      cb = undefined;
    }
  }
  return this._namespace.setRoots(this._rootCtx, roots, cb);
};

/**
 * Sets the Permissions on a namespace.
 * If version is specified and is different from the current version on the
 * Permissions, an error will be returned.
 * Note that setPermissions will completely replace the Permissions on the
 * name.  If you want to update only a part of the Permissions, you must first
 * call getPermissions, modify the returned Permissions, and then call
 * setPermissions with the modified Permissions. You should use the version
 * parameter in this case to ensure that the Permissions has not been modified
 * in between read and write.
 * @param {module:vanadium.context.Context} ctx The rpc context.
 * @param {string} name name to set the Permissions of
 * @param {Map} perms Permissions to set on the name
 * @param {string} version Optional version of the Permissions
 * @param {function} cb(error) Optional callback
 * @return {Promise} A promise to be resolved when setPermissions is complete
 * or rejected when there is an error.
 */
Namespace.prototype.setPermissions = function(ctx, name, perms, version, cb) {
  // TODO(nlacasse): Should we provide an updatePermissions helper method that
  // wraps getPermissions/setPermissions? It's not clear exactly how it would
  // work (what to overwrite, what to append), but we should consider it.
  if (typeof version === 'function') {
    cb = version;
    version = '';
  }
  if (typeof version === 'undefined') {
    version = '';
  }

  return this._namespace.setPermissions(ctx, name, perms, version, cb);
};

/**
 * Gets the Permissions on a namespace.
 * @param {module:vanadium.context.Context} ctx The rpc context.
 * @param {string} name name to get the Permissions of
 * @param {function} cb(error, perms, version) Optional callback
 * @return {Promise} A promise to be resolved when getPermissions is complete
 * or rejected when there is an error.
 */
Namespace.prototype.getPermissions = function(ctx, name, cb) {
  return this._namespace.getPermissions(ctx, name, cb);
};

/**
 * Deletes a name from the namespace, and possibly all names in subtree.
 * @param {module:vanadium.context.Context} ctx The rpc context.
 * @param {string} name name to delete
 * @param {boolean} deleteSubtree whether to delete all decendent names in
 * subtree.  If deleteSubtree is false and the name has decendents, then the
 * deletion will fail.
 * @param {function} cb(error) Optional callback
 * @return {Promise} A promise to be resolved when delete is complete or
 * rejected when there is an error.
 */
Namespace.prototype.delete = function(ctx, name, deleteSubtree, cb) {
  return this._namespace.delete(ctx, name, deleteSubtree, cb);
};

},{"../gen-vdl/v.io/v23/vdlroot/time":56,"../gen-vdl/v.io/x/ref/services/wspr/internal/namespace":62,"../lib/emit-stream-error":70,"stream":25,"util":28}],82:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/*
 * @fileoverview Helpers for manipulating vanadium names.
 * See vanadium/release/go/src/v.io/v23/naming/parse.go for the
 * corresponding operations in golang.
 * @private
 */

module.exports = {
  clean: clean,
  encodeAsNameElement: encodeAsNameElement,
  decodeFromNameElement: decodeFromNameElement,
  join: join,
  isRooted: isRooted,
  basename: basename,
  stripBasename: stripBasename,
  splitAddressName: splitAddressName,
  blessingNamesFromAddress: blessingNamesFromAddress,
};

/**
 * Normalizes a name by collapsing multiple slashes and removing any
 * trailing slashes.
 * @param {string} name The vanadium name.
 * @returns {string} The clean name.
 * @memberof module:vanadium.naming
 */
function clean(name) {
  return _removeTailSlash(_squashMultipleSlashes(name));
}

/**
 * Makes a string representable as a name element by escaping slashes.
 * @param {string} nameElement The vanadium name element to be encoded.
 * @returns {string} Encoded name element that does not contain slashes.
 * @memberof module:vanadium.naming
 */
function encodeAsNameElement(nameElement) {
  var output = nameElement.replace(/%/g, '%25').replace(/\//g, '%2F');
  return output;
}

/**
 * Decodes an encoded name element.
 * Throws exception if encodedNameElement was not properly encoded.
 * Note that this is more than the inverse of encodeAsNameElement since it can
 * handle more hex encodings than / and %.
 * This is intentional since we'll most likely want to add other letters to the
 * set to be encoded.
 * @param {string} encodedNameElement The encoded name element to be decoded.
 * @returns {string} Decoded name element.
 * @memberof module:vanadium.naming
 */
function decodeFromNameElement(encodedNameElement) {
  // decodeURIComponent handles decoding hex percent encoded UTF-8 strings.
  var output = decodeURIComponent(encodedNameElement);
  return output;
}

/**
 * <p>Joins parts of a name into a whole. The joined name will be cleaned; it
 * only preserved the rootedness of the name components.</p>
 * <p>Examples:</p>
 * <pre>
 * join(['a, b']) -> 'a/b'
 * join('/a/b/', '//d') -> '/a/b/d'
 * join('//a/b', 'c/') -> '/a/b/c'
 * </pre>
 * @param {...string} parts Either a single array that contains the strings
 * to join or a variable number of string arguments that will be joined.
 * @return {string} A joined string.
 * @memberof module:vanadium.naming
 */
function join(parts) {
  if (Array.isArray(parts)) {
    while (parts.length > 0 && parts[0] === '') {
      parts.splice(0, 1); // Remove empty strings; they add nothing to the join.
    }
    var joined = parts.join('/');
    return clean(joined);
  }
  return join(Array.prototype.slice.call(arguments));
}

/**
 * Determines if a name is rooted, that is beginning with a single '/'.
 * @param {string} name The vanadium name.
 * @return {boolean} True iff the name is rooted.
 * @memberof module:vanadium.naming
 */
function isRooted(name) {
  return name[0] === '/';
}

// TODO(nlacasse): Should we have a full fledged object parallel to
// naming.Endpoint in Go? Because this parsing is really really shabby!
/**
 * blessingNamesFromAddress extracts the blessing names of the server with the
 * provided address (endpoint).
 *
 * @param {string} address String representation of the server address (aka
 * endpoint).
 * @return {Array<string>} Blessing names extracted from address, or an empty
 * list if none could be extracted.
 * @memberof module:vanadium.naming
 */
function blessingNamesFromAddress(addr) {
  var epversion = endpointVersion(addr);
  if (isNaN(epversion)) {
    // Not a well formed endpoint string.
    // Might be in "host:port" format, if so extract blessing names from that.
    // Format: [(<blessing name>)]@host:port
    var open = addr.indexOf('(');
    var close = addr.indexOf(')');
    if (open === 0 && close > 0 && addr.indexOf('@') === (close + 1)) {
      return addr.substr(1, close - 1).split(',');
    }
    return [];
  }

  var blessingNameField = 0;
  switch(epversion) {
    case 5:
      blessingNameField = 5;
      break;
    case 6:
      blessingNameField = 6;
      break;
    default:
      throw new Error('endpoint version ' + epversion + ' not supported');
  }

  var start = 0;
  // blessing names are the blessingNameField position.
  for (var i = 0; i < blessingNameField; i++) {
    start = addr.indexOf('@', start + 1);
  }
  return addr.substr(start + 1, addr.length - start - 3).split(',');
}

function endpointVersion(addr) {
  // Poor approximation of a well-formed endpoint string.
  // Format described in
  // the Go library documentation for v.io/v23/naming.Endpoint.  Must be at
  // least 7 characters (shortest valid endpoint is: @1@@@@@)
  if (addr.length < 7) {
    return NaN;
  }
  // Must start with an '@' and end with an '@@'
  if (addr.indexOf('@') !== 0) {
    return NaN;
  }
  if (addr.lastIndexOf('@@') !== (addr.length - 2)) {
    return NaN;
  }
  return parseWholeNumber(addr.split('@')[1]);
}

function parseWholeNumber(value) {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return NaN;
}

/**
 * SplitAddressName takes an object name and returns the server address and
 * the name relative to the server.
 * The name parameter may be a rooted name or a relative name; an empty string
 * address is returned for the latter case.
 * @param {string} name The vanadium name.
 * @return {Object.<string, string>}  An object with the address and suffix
 * split. Returned object will be in the format of:
 * <pre>
 * {address: string, suffix: string}
 * </pre>
 * Address may be in endpoint format or host:port format.
 * @memberof module:vanadium.naming
 */
function splitAddressName(name) {
  name = clean(name);

  if (!isRooted(name)) {
    return {
      address: '',
      suffix: name
    };
  }
  name = name.substr(1); // trim the beginning "/"
  if (name.length === 0) {
    return {
      address: '',
      suffix: ''
    };
  }

  if (name[0] === '@') { // <endpoint>/<suffix>
    var split = _splitIntoTwo(name, '@@/');
    if (split.suffix.length > 0) { // The trailing "@@" was stripped, restore
      split.address = split.address + '@@';
    }
    return split;
  }
  if (name[0] === '(') { // (blessing)@host:[port]/suffix
    var tmp = _splitIntoTwo(name, ')@').suffix;
    var suffix = _splitIntoTwo(tmp, '/').suffix;
    return {
      address: _trimEnd(name, '/' + suffix),
      suffix: suffix
    };
  }
  // host:[port]/suffix
  return _splitIntoTwo(name, '/');

  function _splitIntoTwo(str, separator) {
    var elems = str.split(separator);
    return {
      address: elems[0],
      suffix: elems.splice(1).join(separator)
    };
  }
}

/**
 * Gets the basename of the given vanadium name.
 * @param {string} name The vanadium name.
 * @return {string} The basename of the given name.
 * @memberof module:vanadium.naming
 */
function basename(name) {
  name = clean(name);
  var split = splitAddressName(name);
  if (split.suffix !== '') {
    return split.suffix.substring(split.suffix.lastIndexOf('/') + 1);
  } else {
    return split.address;
  }
}

/**
 * Retrieves the parent of the given name.
 * @param {string} name The vanadium name.
 * @return {string | null} The parent's name or null, if there isn't one.
 * @memberof module:vanadium.naming
 */
function stripBasename(name) {
  name = clean(name);
  var split = splitAddressName(name);
  if (split.suffix !== '') {
    return name.substring(0, name.lastIndexOf('/'));
  } else {
    return '';
  }
}

// Replace every group of slashes in the string with a single slash.
function _squashMultipleSlashes(s) {
  return s.replace(/\/{2,}/g, '/');
}

// Remove the last slash in the string, if any.
function _removeTailSlash(s) {
  return s.replace(/\/$/g, '');
}

// Helper util that removes the given suf from the end of str
function _trimEnd(str, suf) {
  var index = str.lastIndexOf(suf);
  if (index + suf.length === str.length) {
    return str.substring(0, index);
  } else {
    return str;
  }
}

},{}],83:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @private
 * @fileoverview An object that handles marshaling and unmarshal
 * messages from the native vanadium implementation.
 */

var EE = require('eventemitter2').EventEmitter2;
var inherits = require('inherits');
var LRU = require('lru-cache');
var MessageType = require('./message-type');
var Incoming = MessageType.Incoming;
var Outgoing = MessageType.Outgoing;
var vlog = require('./../lib/vlog');
var byteUtil = require('../vdl/byte-util');
var unwrap = require('../vdl/type-util').unwrap;
var TypeEncoder = require('../vom/type-encoder');
var Decoder = require('../vom/decoder');
var TypeDecoder = require('../vom/type-decoder');
var RawVomReader = require('../vom/raw-vom-reader');
var ByteMessageReader = require('../vom/byte-message-reader');
var ByteMessageWriter = require('../vom/byte-message-writer');
var ByteStreamMessageReader = require('../vom/byte-stream-message-reader');
var TaskSequence = require('../lib/task-sequence');
var promiseWhile = require('../lib/async-helper').promiseWhile;

// Cache the service signatures for one hour.
var SIGNATURE_CACHE_TTL = 3600 * 1000;

// HandlerState is an object that contains the state for a given flow.  This
// includes an optional handler for incoming messages and a task sequencer for
// decoding incoming messages.
function HandlerState(handler) {
  this.handler = handler;
  this._tasks = new TaskSequence();
}

/**
 * A client for the native vanadium implementation.
 * @constructor
 * @private
 * @param {Promise} senderPromise A promise that is resolved when we are able
 * to send a message to the native veron implementation. It should be resolved
 * with an object that has a send function that will send messages to the native
 * implementation.
 */
function Proxy(senderPromise) {
  // We use odd numbers for the message ids, so that the server can use even
  // numbers.
  this.id = 1;
  this.outstandingRequests = {};
  this.signatureCache = new LRU({
    maxAge: SIGNATURE_CACHE_TTL
  });
  this.senderPromise = senderPromise;
  this.incomingRequestHandlers = {};
  this._typeWriter = new ByteMessageWriter();
  this.typeEncoder = new TypeEncoder(this._typeWriter,
                                     this._writeTypeMessage.bind(this));
  this.typeDecoder = new TypeDecoder();
  this._messageReader = new ByteStreamMessageReader();
  var proxy = this;
  this._isOpen = true;
  promiseWhile(function() {
    return Promise.resolve(proxy._isOpen);
  }, function() {
    return proxy._messageReader.nextMessageType(proxy.typeDecoder)
    .then(function(typeId) {
      if (typeId === null) {
        return proxy.cleanup();
      }
      vlog.logger.error('Unexpected type id ' + typeId);
    }).catch(function(err) {
      vlog.logger.error('Type decoder failed' + err + ': ' + err.stack);
    });
  });
  this.sequence = new TaskSequence();
  EE.call(this);
}
inherits(Proxy, EE);

Proxy.prototype._parseAndHandleMessage = function(message) {
  var messageId;
  var reader = new RawVomReader(message);
  var proxy = this;
  var isServerOriginatedMessage;
  var handlerState;
  return reader.readUint().then(function(id) {
    messageId = id;
    // Messages originating from server are even numbers
    isServerOriginatedMessage = (messageId % 2) === 0;
    handlerState = proxy.outstandingRequests[messageId];

    // If we don't know about this flow, just drop the message. Unless it
    // originated from the sever.
    if (!isServerOriginatedMessage && !handlerState) {
      return;
    }

    if (!handlerState) {
      // This is an server originated message that we are seeing for the
      // first time.  We need to create a handler state so we have the task
      // sequence for the input data.  If a handler gets added later, then
      // it will attached to this state.
      handlerState = new HandlerState();
      proxy.outstandingRequests[messageId] = handlerState;
    }

    return reader.readUint().then(function(type) {
      var decoder = new Decoder(new ByteMessageReader(reader));
      handlerState._tasks.addTask(proxy.processRead.bind(proxy, messageId,
                                                         type,
                                                         handlerState.handler,
                                                         decoder));
    });
  }).catch(function(e) {
    vlog.logger.error(e + ': ' + e.stack);
    if (!isServerOriginatedMessage && handlerState) {
      handlerState.handler.handleResponse(Incoming.ERROR_RESPONSE,
                                          e);
    }
  });
};
/**
 * Handles a message from native vanadium implementation.
 * @private
 * @param {string} messsage The hex encoded message from the native
 * vanadium code.
 */
Proxy.prototype.process = function(message) {
  try {
    message = byteUtil.hex2Bytes(message);
  } catch(e) {
    vlog.logger.warn('Failed to parse ' + message + ' err: ' + e + ': ' +
                     e.stack);
    return;
  }
  this.sequence.addTask(this._parseAndHandleMessage.bind(this, message));
};

Proxy.prototype.processRead = function(id, messageType, handler, decoder) {
  var isServerOriginatedMessage = (id % 2) === 0;
  var proxy = this;
  return decoder.decode().then(function(message) {
    message = unwrap(message);
    // Type messages are handled by the proxy itself.
    if (messageType === Incoming.TYPE_MESSAGE) {
      proxy._messageReader.addBytes(message);
      return;
    }
    // The handler could have been added after we did the lookup but before
    // this decode ran.
    if (!handler) {
      handler = proxy.outstandingRequests[id].handler;
    }
    if (!handler) {
      handler = proxy.incomingRequestHandlers[messageType];
      if (!handler) {
        // There is a race condition where we receive STREAM_CLOSE after we
        // finish sending the response.  This is ok, because if we sent the
        // response, then we didn't care about the stream close message.
        // This will probably go away when we move more of the rpc code into
        // JS.
        vlog.logger.warn('Dropping message for unknown invoke payload ' +
                         messageType + ' (message id: ' + id + ')');
        return;
      }
      return handler.handleRequest(id, messageType, message);
    } else {
      return handler.handleResponse(messageType, message);
    }
  }).catch(function(e) {
    vlog.logger.error(e.stack);
    if (!isServerOriginatedMessage) {
      return handler.handleResponse(Incoming.ERROR_RESPONSE, e);
    }
  });
};

Proxy.prototype.dequeue = function(id) {
  delete this.outstandingRequests[id];
};

Proxy.prototype.nextId = function() {
  var id = this.id;
  this.id += 2;
  return id;
};


Proxy.prototype.addIncomingHandler = function(type, handler) {
  this.incomingRequestHandlers[type] = handler;
};

Proxy.prototype.addIncomingStreamHandler = function(id, handler) {
  if (!this.outstandingRequests[id]) {
    this.outstandingRequests[id] = new HandlerState(handler);
  } else {
    this.outstandingRequests[id].handler = handler;
  }
};

/**
 * Arranges to notify downstream servers when the given
 * context is cancelled.  It also causes outstanding handlers for
 * those requests to receive a cancellation error.
 * @private
 */
Proxy.prototype.cancelFromContext = function(ctx, id) {
  var proxy = this;
  ctx.waitUntilDone().catch(function(error) {
    var h = proxy.outstandingRequests[id];
    proxy.sendRequest(null, Outgoing.CANCEL, null, id);
    if (h && h.handler) {
      h.handler.handleResponse(Incoming.ERROR_RESPONSE, error);
      delete proxy.outstandingRequests[id];
    }
  });
};

/**
 * Establishes the connection if needed, frames the message with the next id,
 * adds the given deferred to outstanding requests queue and sends the request
 * to the server
 * @private
 * @param {Object} message Message to send
 * @param {MessageType} type Type of message to send
 * @param {Object} handler An object with a handleResponse method that takes
 * a response type and a message.  If null, then responses for this flow
 * are ignored.
 * @param {Number} id Use this flow id instead of generating
 * a new one.
 */
Proxy.prototype.sendRequest = function(message, type, handler, id) {
  if (handler) {
    this.addIncomingStreamHandler(id, handler);
  }
  var body = {
    id: id,
    data: message,
    type: type
  };

  var self = this;
  this.senderPromise.then(function(sender) {
    sender.send(body);
  }).catch(function(err) {
    // TODO(jasoncampbell): Add tests that cover this case, also sender.send
    // above is async and will break out of the try/catch promise mechanism
    // in node.
    var h = self.outstandingRequests[id];

    if (h && h.handler) {
      h.handler.handleResponse(Incoming.ERROR_RESPONSE, err);
      delete self.outstandingRequests[id];
    }
  });
};

Proxy.prototype._writeTypeMessage = function() {
  this.sendRequest(byteUtil.bytes2Hex(this._typeWriter.getBytes()),
                    Outgoing.TYPE_MESSAGE, null, 0);
  this._typeWriter.reset();
};

Proxy.prototype.cleanup = function() {
  this._isOpen = false;
};
/*
 * Export the module
 */
module.exports = Proxy;

},{"../lib/async-helper":68,"../lib/task-sequence":76,"../vdl/byte-util":125,"../vdl/type-util":144,"../vom/byte-message-reader":158,"../vom/byte-message-writer":159,"../vom/byte-stream-message-reader":160,"../vom/decoder":162,"../vom/raw-vom-reader":167,"../vom/type-decoder":170,"../vom/type-encoder":171,"./../lib/vlog":79,"./message-type":84,"eventemitter2":30,"inherits":32,"lru-cache":34}],84:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Enums for low level message types.
 * @private
 */

module.exports = {
  Outgoing: {
    REQUEST: 0, // Request to invoke a method on a Vanadium name.
    RESPONSE: 2, // Indicates a response from a JavaScript server.
    STREAM_VALUE: 3, // Indicates a stream value.
    STREAM_CLOSE: 4, // Request to close a stream.
    LOOKUP_RESPONSE: 11, // Response from a lookup call to Javacript.
    AUTHORIZATION_RESPONSE: 12, // Response from an authorization call to JS.
    CANCEL: 17, // Cancel an ongoing JS initiated call.
    CAVEAT_VALIDATION_RESPONSE: 21, // Response to a caveat validation request.
    GRANTER_RESPONSE: 22, // Response from a granter
    TYPE_MESSAGE: 23,  // A type message from javascript.
  },
  Incoming: {
    INVOKE_REQUEST: 3, // Request to invoke a method on a JS server.
    FINAL_RESPONSE: 0, // Final response to a call originating from JS.
    ERROR_RESPONSE: 2, // Error response to a call originating from JS.
    STREAM_RESPONSE: 1, // Stream response to a call originating from JS.
    STREAM_CLOSE: 4,  // Response saying that the stream is closed.
    LOOKUP_REQUEST: 5, // A request to perform a dispatcher lookup.
    AUTHORIZATION_REQUEST: 6,  // A request to authorize an rpc.
    CANCEL: 7, // A request to cancel a previously invoked JS method.
    CAVEAT_VALIDATION_REQUEST: 8, // A request to validate a set of caveats
    LOG_MESSAGE: 9,  // A request to log a message.
    GRANTER_REQUEST: 10, // A request to call a granter
    BLESSINGS_CACHE_MESSAGE: 11, // A request to update the blessings cache
    TYPE_MESSAGE: 12,  // A type message from go.
  }
};

},{}],85:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Forwards messages to and from a nacl module.
 * @private
 */

var Deferred = require('../lib/deferred');
var errors = require('../verror/index');
var extensionEventProxy = require('../browser/event-proxy');
var Proxy = require('./index');
var TaskSequence = require('../lib/task-sequence');
var random = require('../lib/random');

module.exports = ProxyConnection;

/**
 * A client for the vanadium service using postMessage. Connects to the vanadium
 * browspr and performs RPCs.
 * @constructor
 * @private
 */
function ProxyConnection() {
  var self = this;

  this.instanceId = random.hex();
  this._tasks = new TaskSequence();

  this.onBrowsprMsg = function(msg) {
    if (self.instanceId === msg.instanceId) {
      self.process(msg.body);
    }
  };

  extensionEventProxy.on('browsprMsg', this.onBrowsprMsg);

  // rethrow crash error when proxy fails.
  this.onCrash = function(msg) {
    self.emit('crash', new errors.ExtensionCrashError(msg));
  };

  extensionEventProxy.on('crash', this.onCrash);

  var def = new Deferred();
  Proxy.call(this, def.promise);
  def.resolve(this);
}

ProxyConnection.prototype = Object.create(Proxy.prototype);

ProxyConnection.prototype.constructor = ProxyConnection;

ProxyConnection.prototype.send = function(msg) {
  var wrappedMsg = {
    instanceId: this.instanceId,
    msg: msg
  };
  extensionEventProxy.send('browsprMsg', wrappedMsg);
};

ProxyConnection.prototype.close = function(cb) {
  var self = this;
  var defaultTimeout = 2000;
  var deferred = new Deferred(cb);
  this.cleanup();

  extensionEventProxy.removeListener('crash', this.onCrash);

  extensionEventProxy.send('browsprCleanup', {
    instanceId: this.instanceId
  });

  var timedout = false;
  var timeout = setTimeout(function reject() {
    timedout = true;
    extensionEventProxy.removeListener('browsprMsg', self.onBrowsprMsg);
    var err = new Error('Timeout: Failed to close the runtime in ' +
      defaultTimeout + ' ms');

    deferred.reject(err);
  }, defaultTimeout);

  extensionEventProxy.once('browsprCleanupFinished', function() {
    extensionEventProxy.removeListener('browsprMsg', self.onBrowsprMsg);
    clearTimeout(timeout);
    if(!timedout) {
      deferred.resolve();
    }
  });

  return deferred.promise;
};

ProxyConnection.prototype.createInstance = function(settings, cb) {
  var msg = {
    instanceId: this.instanceId,
    settings: settings
  };
  extensionEventProxy.sendRpc('createInstance', msg, cb);
};

},{"../browser/event-proxy":43,"../lib/deferred":69,"../lib/random":74,"../lib/task-sequence":76,"../verror/index":151,"./index":83}],86:[function(require,module,exports){
(function (process){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var Incoming = require('./message-type').Incoming;
var emitStreamError = require('../lib/emit-stream-error');
var vError = require('../gen-vdl/v.io/v23/verror');
var SharedContextKeys = require('../runtime/shared-context-keys');
var BlessingsId =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/principal').BlessingsId;
var runtimeFromContext = require('../runtime/runtime-from-context');
var TaskSequence = require('../lib/task-sequence');
var Promise = require('../lib/promise');
var vom = require('../vom');
var byteUtil = require('../vdl/byte-util');

module.exports = Handler;

/*
 * A simple incoming stream handler that handles incoming response, error
 * and close messages and queues them on the given stream object.
 * @param {Stream} Stream instance
 * @constructor
 */
function Handler(ctx, stream, typeDecoder) {
  this._ctx = ctx;
  this._stream = stream;
  this._controller = ctx.value(SharedContextKeys.RUNTIME)._controller;
  this._pendingBlessings = [];
  this._tasks = new TaskSequence();
  this._typeDecoder = typeDecoder;
}

Handler.prototype.handleResponse = function(type, data) {
  switch (type) {
    case Incoming.STREAM_RESPONSE:
      this._tasks.addTask(this.handleStreamData.bind(this, data));
     return true;
    case Incoming.STREAM_CLOSE:
      this._tasks.addTask(this.handleStreamClose.bind(this, data));
      return true;
    case Incoming.ERROR_RESPONSE:
      this._tasks.addTask(this.handleStreamError.bind(this, data));
      return true;
    case Incoming.CANCEL:
      this._tasks.addTask(this.handleCancel.bind(this));
      return true;
  }

  // can't handle the given type
  return false;
};

Handler.prototype.handleStreamData = function(data) {
  try {
    data = byteUtil.hex2Bytes(data);
  } catch (e) {
    emitStreamError(this._stream,
                    new vError.InternalError(this._ctx,
                                             'Failed to decode result: ', e));
    return Promise.resolve();
  }
  var handler = this;
  return vom.decode(data, false, this._typeDecoder).then(function(data) {
    if (data instanceof BlessingsId) {
      var runtime = runtimeFromContext(handler._ctx);
      runtime.blessingsCache.blessingsFromId(data)
      .then(function(blessings) {
        blessings.retain();
        handler._stream._queueRead(blessings);
      });
    } else {
      handler._stream._queueRead(data);
    }
  }, function(e) {
    emitStreamError(handler._stream,
                    new vError.InternalError(
                      handler._ctx, 'Failed to decode result: ', e));
  }).catch(function(e) {
    process.nextTick(function() {
      throw e;
    });
  });
};

Handler.prototype.handleStreamClose = function() {
  this.cleanupBlessings();
  this._stream._queueClose();
  return Promise.resolve();
};

Handler.prototype.handleStreamError = function(data) {
  emitStreamError(this._stream, data);
  return this.handleStreamClose();
};

Handler.prototype.cleanupBlessings = function() {
  for (var i = 0; i < this._pendingBlessings; i++) {
    this._pendingBlessings[i].release();
  }
};

Handler.prototype.handleCancel = function() {
  if (this.ctx && this.ctx.cancel) {
    this.ctx.cancel();
  }
};

}).call(this,require('_process'))
},{"../gen-vdl/v.io/v23/verror":57,"../gen-vdl/v.io/x/ref/services/wspr/internal/principal":63,"../lib/emit-stream-error":70,"../lib/promise":73,"../lib/task-sequence":76,"../runtime/runtime-from-context":104,"../runtime/shared-context-keys":105,"../vdl/byte-util":125,"../vom":165,"./message-type":84,"_process":11}],87:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Streaming RPC implementation on top of websockets.
 * @private
 */

var Outgoing = require('./message-type').Outgoing;
var Duplex = require('stream').Duplex;
var vlog = require('../lib/vlog');
var inherits = require('inherits');
var reduce = require('../vdl/canonicalize').reduce;
var unwrap = require('../vdl/type-util').unwrap;
var ServerRpcReply =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/lib').ServerRpcReply;
var hexVom = require('../lib/hex-vom');

/**
 * @summary
 * A stream that allows sending and receiving data for a streaming rpc.
 * @description
 * <p>Stream is a
 * [Duplex Node.js stream]{@link https://nodejs.org/api/stream.html}
 * in 'objectMode'.
 * This constructor should not be directly called.</p>
 *
 * <p>If a 'data' event handler is specified, it will be called with data as
 * they become available.
 * <pre>
 *  stream.on('data', function(obj) {
 *    console.log(obj);
 *  });
 * </pre></p>
 * <p>
 * All other [Node.js stream]{@link https://nodejs.org/api/stream.html} events,
 * properties and function are also available on this stream as well.
 * </p>
 * @constructor
 * @inner
 * @memberof module:vanadium.rpc
 */
var Stream = function(flowId, webSocketPromise, isClient, readType, writeType,
                      typeEncoder) {
  Duplex.call(this, { objectMode: true });
  this.flowId = flowId;
  this.isClient = isClient;
  this.readType = readType;
  this.writeType = writeType;
  this.webSocketPromise = webSocketPromise;
  this.onmessage = null;
  this._typeEncoder = typeEncoder;

  // The buffer of messages that will be passed to push
  // when the internal buffer has room.
  this.wsBuffer = [];

  // If set, objects are directly written to the internal buffer
  // rather than wsBuffer.
  this.shouldQueue = false;
};

inherits(Stream, Duplex);

/**
 * Closes the stream, telling the other side that there is no more data.
 */
Stream.prototype.clientClose = function() {
  var object = {
    id: this.flowId,
    type: Outgoing.STREAM_CLOSE
  };
  Duplex.prototype.write.call(this, object);
};

Stream.prototype.serverClose = function(results, err, traceResponse) {
  var object = {
    id: this.flowId,
    type: Outgoing.RESPONSE,
    data: hexVom.encode(new ServerRpcReply({
      results: results,
      err: err || null,
      traceResponse: traceResponse
    }), undefined, this._typeEncoder)
  };
  Duplex.prototype.write.call(this, object);
};

/**
 * Implements the _read method needed by those subclassing Duplex.
 * The parameter passed in is ignored, since it doesn't really make
 * sense in object mode.
 * @private
 */
Stream.prototype._read = function(size) {
  // On a call to read, copy any objects in the websocket buffer into
  // the internal stream buffer.  If we exhaust the websocket buffer
  // and still have more room in the internal buffer, we set shouldQueue
  // so we directly write to the internal buffer.
  var stream = this;
  var next = stream.wsBuffer.shift();

  // There could be a null value in stream.wsBuffer marking the end of the
  // stream, the explicit undefined check is to ensure empty values from the
  // stream.wsBuffer.shift() call above (marking an empty stream.wsBuffer array)
  // don't get pushed into the stream pipeline.
  if (typeof next !== 'undefined') {
    stream.push(next);
  }

  stream.shouldQueue = stream.wsBuffer.length === 0;
};

/**
 * Queue the object passed in for reading
 * TODO(alexfandrianto): Is this private? We call it in other places, and it
 * isn't overriding any of node's duplex stream functions.
 * @private
 */
Stream.prototype._queueRead = function(object) {
  if (!this.readType) {
    vlog.logger.warn('This stream cannot be read from. The service method ' +
      'lacks an', this.isClient ? 'outStream' : 'inStream', 'type. Tried to ' +
      'queue', object);
    return;
  }
  // Fill the read stream with the correct type.
  var canonObj = unwrap(reduce(object, this.readType));
  this._queueData(canonObj);
};

/**
 * Queue the close signal onto the Duplex's queue.
 * @private
 */
Stream.prototype._queueClose = function() {
  this._queueData(null);
};

/**
 * Queues the data onto the Duplex's queue.
 * @private
 */
Stream.prototype._queueData = function(data) {
  if (this.shouldQueue) {
    // If we have run into the limit of the internal buffer,
    // update this.shouldQueue.
    this.shouldQueue = this.push(data);
  } else {
    this.wsBuffer.push(data);
  }
};

/**
 * Writes an object to the stream.
 * @param {*} chunk The data to write to the stream.
 * @param {string} [encoding=null] ignored for object streams.
 * @param {module:vanadium~voidCb} cb If set, the function to call when the
 * write completes.
 * @return {boolean} Returns false if the write buffer is full.
 */
Stream.prototype.write = function(chunk, encoding, cb) {
  if (!this.writeType) {
    vlog.logger.warn('This stream cannot be written to. The service method ' +
      'lacks an',
      this.isClient ? 'inStream' : 'outStream', 'type. Tried to queue', chunk);
    return;
  }
  var object = {
    id: this.flowId,
    data: hexVom.encode(chunk, this.writeType, this._typeEncoder),
    type: Outgoing.STREAM_VALUE
  };
  return Duplex.prototype.write.call(this, object, encoding, cb);
};

Stream.prototype._write = function(chunk, encoding, cb) {
  this.webSocketPromise.then(function(websocket) {
    websocket.send(chunk);
    cb();
  });
};

/**
 * Writes an optional object to the stream and ends the stream.
 * @param {*} chunk The data to write to the stream.
 * @param {string} [encoding=null] Ignored for object streams.
 * @param {module:vanadium~voidCb} cb If set, the function to call when the
 * end call completes.
 */
Stream.prototype.end = function(chunk, encoding, cb) {
  if (this.isClient) {
    if (chunk !== undefined) {
      this.write(chunk, encoding);
    }
    this.clientClose();
  } else {
    // We probably shouldn't allow direct calls to end, since we need
    // a return value here, but if they are piping streams, the developer
    // probably doesn't care about the return value.
    this.serverClose();
  }

  Duplex.prototype.end.call(this, null, null, cb);
};

module.exports = Stream;

},{"../gen-vdl/v.io/x/ref/services/wspr/internal/lib":61,"../lib/hex-vom":71,"../lib/vlog":79,"../vdl/canonicalize":126,"../vdl/type-util":144,"./message-type":84,"inherits":32,"stream":25}],88:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @private
 * @fileoverview WebSocket client implementation
 */

var isBrowser = require('is-browser');
var WebSocket = require('ws');

var Deferred = require('./../lib/deferred');
var TaskSequence = require('./../lib/task-sequence');
var Proxy = require('./index');
var vlog = require('./../lib/vlog');

/**
 * A client for the vanadium service using websockets. Connects to the vanadium
 * wspr and performs RPCs.
 * @constructor
 * @private
 * @param {string} url of wspr that connects to the vanadium network
 * identity
 */
function ProxyConnection(url) {
  this.url = url.replace(/^(http|https)/, 'ws') + '/ws';
  this.currentWebSocketPromise = null;
  // Since we haven't finished constructing the Proxy object,
  // we can't call this.getWebsocket() to return the sender promise.
  // Instead, we create a new promise that will eventually call
  // getWebsocket and only resolve the promise after Proxy.call
  // has completed.
  var def = new Deferred();
  Proxy.call(this, def.promise);
  var proxy = this;
  this.getWebSocket().then(function success() {
    def.resolve(proxy);
  }, def.reject);
  this._tasks = new TaskSequence();
}

ProxyConnection.prototype = Object.create(Proxy.prototype);

ProxyConnection.prototype.constructor = ProxyConnection;

/**
 * Connects to the server and returns an open web socket connection
 * @private
 * @return {promise} a promise that will be fulfilled with a websocket object
 * when the connection is established.
 */
ProxyConnection.prototype.getWebSocket = function() {
  // We are either connecting or already connected, return the same promise
  if (this.currentWebSocketPromise) {
    return this.currentWebSocketPromise;
  }

  // TODO(bjornick): Implement a timeout mechanism.
  var websocket = new WebSocket(this.url);
  var self = this;
  var deferred = new Deferred();
  this.currentWebSocketPromise = deferred.promise;
  websocket.onopen = function() {
    vlog.logger.info('Connected to wspr at', self.url);
    deferred.resolve(websocket);
  };
  websocket.onerror = function(e) {
    var isEvent = isBrowser && !!window.Event && e instanceof window.Event;
    var isErrorEvent = isEvent && e.type === 'error';

    // It's possible to get a DOM WebSocket error event here, which is not an
    // actual Error object, so we must turn it into one.
    if (isErrorEvent) {
      e = new Error('WebSocket error.');
    }

    // Add a more descriptive message to the error.
    // TODO(jasoncampbell): there can be more errors than just failed
    // connection, additionally there can be more than one error emitted. We
    // should take care to cover these cases.
    e.message = 'Failed to connect to wspr at url ' + self.url +
        ': ' + e.message;

    vlog.logger.error(e);
    deferred.reject(e);
  };

  websocket.onmessage = function(frame) {
    self.process(frame.data);
  };

  return deferred.promise;
};

ProxyConnection.prototype.send = function(msg) {
  this.getWebSocket().then(function(ws) {
    ws.send(JSON.stringify(msg));
  }).catch(function(err) {
    throw err;
  });
};

ProxyConnection.prototype.close = function(cb) {
  var deferred = new Deferred(cb);
  this.cleanup();

  this.getWebSocket().then(close, function(err) {
    // TODO(jasoncampbell): Better error handling around websocket connection
    // It's possible that the initial connection failed with
    // "Error: getaddrinfo ENOTFOUND" Since there was not a
    // connection to begin with in this case it can be considered
    // successfully closed.
    deferred.resolve();
  });

  return deferred.promise;

  function close(websocket) {
    websocket.onclose = deferred.resolve;
    websocket.close();
  }
};

/**
 * Export the module
 */
module.exports = ProxyConnection;

},{"./../lib/deferred":69,"./../lib/task-sequence":76,"./../lib/vlog":79,"./index":83,"is-browser":33,"ws":40}],89:[function(require,module,exports){
(function (process){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 *  @fileoverview Client for the vanadium service.
 *
 *  Usage:
 *  var cl = new client(proxyConnection);
 *  var service = cl.bindTo('EndpointAddress', 'ServiceName');
 *  resultPromise = service.MethodName(arg);
 *  @private
 */

var actions = require('../verror/actions');
var byteUtil = require('../vdl/byte-util');
var Controller =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/app').Controller;
var context = require('../context');
var Deferred = require('../lib/deferred');
var emitStreamError = require('../lib/emit-stream-error');
var Incoming = require('../proxy/message-type').Incoming;
var makeError = require('../verror/make-errors');
var Outgoing = require('../proxy/message-type').Outgoing;
var Promise = require('../lib/promise');
var ReservedSignature =
  require('../gen-vdl/v.io/v23/rpc').ReservedSignature.val;
var RpcCallOption =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/app').RpcCallOption;
var RpcRequest =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/app').RpcRequest;
var Stream = require('../proxy/stream');
var time = require('../gen-vdl/v.io/v23/vdlroot/time');
var uncapitalize = require('../vdl/util').uncapitalize;
var unwrap = require('../vdl/type-util').unwrap;
var vdl = require('../vdl');
var verror = require('../gen-vdl/v.io/v23/verror');
var vlog = require('../lib/vlog');
var SharedContextKeys = require('../runtime/shared-context-keys');
var vtrace = require('../vtrace');
var ByteMessageWriter = require('../vom/byte-message-writer');
var BlessingsId =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/principal').BlessingsId;
var Encoder = require('../vom/encoder');
var TaskSequence = require('../lib/task-sequence');
var runtimeFromContext = require('../runtime/runtime-from-context');
var vom = require('../vom');

var OutstandingRPC = function(ctx, options, cb) {
  this._ctx = ctx;
  this._controller = ctx.value(SharedContextKeys.RUNTIME)._controller;
  this._proxy = options.proxy;
  this._id = -1;
  this._name = options.name;
  this._methodName = options.methodName,
  this._args = options.args;
  this._outArgTypes = options.outArgTypes;
  this._numOutParams = options.numOutParams;
  this._isStreaming = options.isStreaming || false;
  this._inStreamingType = options.inStreamingType;
  this._outStreamingType = options.outStreamingType;
  this._callOptions = options.callOptions;
  this._cb = cb;
  this._typeEncoder = options.typeEncoder;
  this._typeDecoder = options.typeDecoder;
  this._def = null;
  this._tasks = new TaskSequence();
};

// Helper function to convert an out argument to the given type.
function convertOutArg(ctx, arg, type, controller) {
  if (arg instanceof BlessingsId) {
    var runtime = runtimeFromContext(ctx);
    return runtime.blessingsCache.blessingsFromId(arg);
  }

  // There's no protection against bad out args if it's a JSValue.
  // Otherwise, convert to the out arg type to ensure type correctness.
  if (!type.equals(vdl.types.JSVALUE)) {
    try {
      return Promise.resolve(unwrap(vdl.canonicalize.reduce(arg, type)));
    } catch(err) {
      return Promise.reject(err);
    }
  }

  return Promise.resolve(unwrap(arg));
}

OutstandingRPC.prototype.start = function() {
  this._id = this._proxy.nextId();
  var ctx = this._ctx;
  var self = this;

  var outArgTypes = this._outArgTypes;

  var def = new Deferred();
  var cb = this._cb;
  var promise = def.promise.then(function(args) {
    if (!Array.isArray(args)) {
      throw new verror.InternalError(
        ctx, 'Internal error: incorrectly formatted out args in client');
    }

    return Promise.all(args.map(function(outArg, i) {
      return convertOutArg(ctx, outArg, outArgTypes[i], self._controller);
    }));
  }).then(function(results) {
    if (cb) {
      // Make a copy the results to so we can push a null for the
      // error onto the front of the arg list.
      var cbArgs = results.slice();
      cbArgs.unshift(null);
      try {
        cb.apply(null, cbArgs);
      } catch (e) {
        process.nextTick(function() {
          throw e;
        });
      }
    }
    // If we are using a promise, strip single args out of the arg array.
    // e.g. [ arg1 ] -> arg1
    switch(results.length) {
      // We expect:
      // 0 args - return; // NOT return [];
      // 1 args - return a; // NOT return [a];
      // 2 args - return [a, b] ;
      //
      // Convert the results from array style to the expected return style.
      // undefined, a, [a, b], [a, b, c] etc
      case 0:
        return undefined;
      case 1:
        return results[0];
      default:
        return results;
    }
  });

  if (cb) {
    promise.catch(function(err) {
      try {
        cb(err);
      } catch(e) {
        process.nextTick(function() {
          throw e;
        });
      }
    });
  }

  var streamingDeferred = null;
  if (this._isStreaming) {
    streamingDeferred = new Deferred();
    // Clients read data of type outStreamingType and write data of type
    // inStreamingType.
    def.stream = new Stream(this._id, streamingDeferred.promise, true,
      this._outStreamingType, this._inStreamingType, this._typeEncoder);
    promise.stream = def.stream;
  }

  var message = this.constructMessage();

  this._def = def;
  this._proxy.cancelFromContext(this._ctx, this._id);
  this._proxy.sendRequest(message, Outgoing.REQUEST, this, this._id);
  if (streamingDeferred) {
    this._proxy.senderPromise.then(function(ws) {
      streamingDeferred.resolve(ws);
    }, function(err) {
      streamingDeferred.reject(err);
    });
  }

  return promise;
};

OutstandingRPC.prototype.handleResponse = function(type, data) {
  var rpc = this;
  switch (type) {
    case Incoming.FINAL_RESPONSE:
      this._tasks.addTask(function() {
        return rpc.handleCompletion(data);
      });
      break;
    case Incoming.STREAM_RESPONSE:
      this._tasks.addTask(function() {
        return rpc.handleStreamData(data);
      });
      break;
    case Incoming.ERROR_RESPONSE:
      this._tasks.addTask(function() {
        return rpc.handleError(data);
      });
      break;
    case Incoming.STREAM_CLOSE:
      this._tasks.addTask(function() {
        return rpc.handleStreamClose();
      });
      break;
    default:
      this._tasks.addTask(function() {
        return rpc.handleError(
            new verror.InternalError(
              rpc._ctx, 'Received unknown response type from wspr'));
      });
      break;
  }
};

OutstandingRPC.prototype.handleCompletion = function(data) {
  var bytes;
  try {
    bytes = byteUtil.hex2Bytes(data);
  } catch (e) {
    this.handleError(
      new verror.InternalError(this._ctx, 'Failed to decode result: ', e));
      return Promise.resolve();
  }
  var rpc = this;
  return vom.decode(bytes, false, this._typeDecoder).then(function(response) {
    vtrace.getStore(rpc._ctx).merge(response.traceResponse);
    vtrace.getSpan(rpc._ctx).finish();

    rpc._def.resolve(response.outArgs);
    if (rpc._def.stream) {
      rpc._def.stream._queueClose();
    }
    rpc._proxy.dequeue(rpc._id);
  }).catch(function(e) {
    rpc.handleError(
      new verror.InternalError(rpc._ctx, 'Failed to decode result: ', e));
    return;
  });
};

OutstandingRPC.prototype.handleStreamData = function(data) {
  if (!this._def.stream) {
    vlog.logger.warn('Ignoring streaming message for non-streaming flow : ' +
        this._id);
    return Promise.resolve();
  }
  try {
    data = byteUtil.hex2Bytes(data);
  } catch (e) {
    this.handleError(
      new verror.InternalError(this._ctx, 'Failed to decode result: ', e));
      return;
  }
  var rpc = this;
  return vom.decode(data, false, this._typeDecoder).then(function(data) {
    rpc._def.stream._queueRead(data);
  }, function(e) {
    rpc.handleError(
      new verror.InternalError(rpc._ctx, 'Failed to decode result: ', e));
  }).catch(function(e) {
    process.nextTick(function() {
      throw e;
    });
  });
};

OutstandingRPC.prototype.handleStreamClose = function() {
  if (this._def.stream) {
    this._def.stream._queueClose();
  }
  return Promise.resolve();
};

OutstandingRPC.prototype.handleError = function(err) {
  if (this._def.stream) {
    emitStreamError(this._def.stream, err);
    this._def.stream._queueClose();
  }
  this._def.reject(err);
  this._proxy.dequeue(this._id);
  return Promise.resolve();
};


/**
 * Construct a message to send to the vanadium native code
 * @private
 * @return {string} json string to send to jspr
 */
OutstandingRPC.prototype.constructMessage = function() {
  var deadline = this._ctx.deadline();
  var timeout = new time.WireDeadline();
  if (deadline !== null) {
    var millis = deadline - Date.now();
    var seconds = Math.floor(millis / 1000);
    timeout.fromNow = new time.Duration({
      seconds: seconds,
      nanos: (millis - seconds * 1000) * 1000000
    });
  } else {
    timeout.noDeadline = true;
  }

  var language = this._ctx.value(SharedContextKeys.LANG_KEY) || '';
  var jsonMessage = {
    name: this._name,
    method: this._methodName,
    numInArgs: this._args.length,
    // TODO(bprosnitz) Is || 0 needed?
    numOutArgs: this._numOutParams || 0,
    isStreaming: this._isStreaming,
    traceRequest: vtrace.request(this._ctx),
    deadline: timeout,
    callOptions: this._callOptions,
    context: {
      language: language,
    }
  };

  var writer = new ByteMessageWriter();
  var encoder = new Encoder(writer, this._typeEncoder);
  encoder.encode(jsonMessage, RpcRequest.prototype._type);
  for (var i = 0; i < this._args.length; i++) {
    encoder.encode(this._args[i]);
  }
  return byteUtil.bytes2Hex(writer.getBytes());
};

/**
 * @summary Client represents the interface for making RPC calls.
 * There may be multiple outstanding Calls associated with a single Client.
 *
 * @description
 * <p>Private Constructor, use
 * [Runtime#getClient]{@link module:vanadium~Runtime#getClient}</p>
 * @inner
 * @constructor
 * @memberof module:vanadium.rpc
 */
function Client(proxyConnection) {
  if (!(this instanceof Client)) {
    return new Client(proxyConnection);
  }

  this._proxyConnection = proxyConnection;
  if (proxyConnection && proxyConnection.typeEncoder) {
    this._typeEncoder = proxyConnection.typeEncoder;
  }
  if (proxyConnection && proxyConnection.typeDecoder) {
    this._typeDecoder = proxyConnection.typeDecoder;
  }
  this._controller = this.bindWithSignature(
    '__controller', [Controller.prototype._serviceDescription]);
}

// TODO(bprosnitz) v.io/core/javascript.IncorrectArgCount.
var IncorrectArgCount = makeError(
  'v.io/core/javascript.IncorrectArgCount',
  actions.NO_RETRY,
  '{1:}{2:} Client RPC call {3}({4}) had an incorrect number of ' +
  'arguments. Expected format: {5}({6})');

/**
 * A callback that is called when
 * [bindTo]{@link module:vanadium.rpc~Client#bindTo} finishes.
 * @callback module:vanadium.rpc~Client~bindToCb
 * @param {Error} err If set the error that occurred.
 * @param {object} service The stub object containing the exported
 * methods of the remote service.
 */
/**
 * <p>Performs client side binding of a remote service to a native JavaScript
 * stub object.</p>
 *
 * Usage:
 * <pre>
 * client.bindTo(context, 'Service/Name').then(function(service) {
 *    service.fooMethod(fooArgs).then(function(methodCallResult) {
 *      // Do stuff with results.
 *    }).catch(function(err) {
 *       // Calling fooMethod failed.
 *     });
 * }).catch(function(err) {
 *     // Binding to Service/Name failed.
 * });
 * </pre>
 * @param {module:vanadium.context.Context} ctx A context.
 * @param {string} name The vanadium name of the service to bind to.
 * @param {module:vanadium.rpc~Client~bindToCb} [cb] If given, this function
 * will be called on completion of the bind.
 * @return {Promise<object>} Promise that resolves to the stub object containing
 * the exported methods of the remote service.
 */
Client.prototype.bindTo = function(ctx, name, cb) {
  var client = this;
  var last = arguments.length - 1;

  // grab the callback
  if (typeof arguments[last] === 'function') {
    cb = arguments[last];
  }

  var def = new Deferred(cb);

  // Require first arg to be a Context
  if (! (ctx instanceof context.Context)) {
    var err = new Error('First argument must be a Context object.');

    def.reject(err);

    return def.promise;
  }

  client.signature(ctx, name).then(function(serviceSignature) {
    vlog.logger.debug('Received signature for:', name, serviceSignature);
    def.resolve(client.bindWithSignature(name, serviceSignature));
  }).catch(function(err) {
    def.reject(err);
  });

  return def.promise;
};

/**
 * <p>Performs client side binding of a remote service to a native JavaScript
 * stub object when you already have the service signature.</p>
 *
 * Usage:
 * <pre>
 * var service = client.bindWithSignature('Service/Name', signature);
 * service.fooMethod(fooArgs).then(function(methodCallResult) {
 *   // Do stuff with results.
 * }).catch(function(err) {
 *   // Calling fooMethod failed.
 * });
 * </pre>
 *
 * @param {string} name The vanadium name of the service to bind to.
 * @param {module:vanadium.vdl.signature.Interface} signature The service
 * signature of a vanadium service.
 * @return {object} The stub object containing
 * the exported methods of the remote service.
 */
Client.prototype.bindWithSignature = function(name, signature) {
  var client = this;
  var boundObject = {};

  function bindMethod(methodSig) {
    var method = uncapitalize(methodSig.name);

    boundObject[method] = function(ctx /*, arg1, arg2, ..., callback*/) {
      var args = Array.prototype.slice.call(arguments, 0);
      var callback;
      var err;

      // Callback is the last function argument, pull it out of the args
      var lastType = typeof args[args.length - 1];
      if (lastType === 'function') {
        callback = args.pop();
      }

      // Require first arg to be a Context
      if (args.length >= 1 && args[0] instanceof context.Context) {
        ctx = args.shift();
      } else {
        err = new Error('First argument must be a Context object.');

        if (callback) {
          return callback(err);
        } else {
          return Promise.reject(err);
        }
      }

      // Remove ClientCallOptions from args and build array of callOptions.
      var callOptions = [];
      args = args.filter(function(arg) {
        if (arg instanceof ClientCallOption) {
          callOptions = callOptions.concat(
            arg._toRpcCallOption(ctx, client._proxyConnection));
          return false;
        }
        return true;
      });

      ctx = vtrace.withNewSpan(ctx, '<jsclient>"'+name+'".'+method);

      // If the last value was undefined, and there is 1 too many args, the
      // undefined is an undefined cb, not an undefined arg.
      if (args.length === methodSig.inArgs.length + 1 &&
        lastType === 'undefined') {

        args.pop();
      }

      if (args.length !== methodSig.inArgs.length) {

        var expectedArgs = methodSig.inArgs.map(function(arg) {
          return arg.name;
        });

        // TODO(jasoncampbell): Create an constructor for this error so it
        // can be created with less ceremony and checked in a
        // programatic way:
        //
        //     service
        //     .foo('bar')
        //     .catch(ArgumentsArityError, function(err) {
        //       console.error('invalid number of arguments')
        //     })
        //

        // The given arguments exclude the ctx and (optional) cb.
        var givenArgs = Array.prototype.slice.call(arguments, 1);
        if (lastType === 'function') {
          givenArgs.pop();
        }
        err = new IncorrectArgCount(
          ctx,
          methodSig.name,
          givenArgs,
          methodSig.name,
          expectedArgs
        );
        if (callback) {
          return callback(err);
        } else {
          return Promise.reject(err);
        }
      }

      // The inArgs need to be converted to the signature's inArg types.
      var canonArgs = new Array(args.length);
      try {
        for (var i = 0; i < args.length; i++) {
          canonArgs[i] = vdl.canonicalize.fill(args[i],
                                               methodSig.inArgs[i].type);

        }
      } catch(err) {
        vlog.logger.error('rpc failed - invalid arg(s)', err);
        if (callback) {
          return callback(err);
        } else {
          return Promise.reject(err);
        }
      }

      // The OutstandingRPC needs to know streaming information.
      var inStreaming = (typeof methodSig.inStream === 'object'  &&
                         methodSig.inStream !== null);
      var outStreaming = (typeof methodSig.outStream === 'object' &&
                          methodSig.outStream !== null);
      var isStreaming = inStreaming || outStreaming;

      // The OutstandingRPC needs to know the out arg types.
      var outArgTypes = methodSig.outArgs.map(function(outArg) {
        return outArg.type;
      });

      var rpc = new OutstandingRPC(ctx, {
        proxy: client._proxyConnection,
        name: name,
        methodName: methodSig.name,
        args: canonArgs,
        outArgTypes: outArgTypes,
        numOutParams: methodSig.outArgs.length,
        isStreaming: isStreaming,
        inStreamingType: inStreaming ? methodSig.inStream.type : null,
        outStreamingType: outStreaming ? methodSig.outStream.type : null,
        callOptions: callOptions,
        typeEncoder: client._typeEncoder,
        typeDecoder: client._typeDecoder,
      }, callback);

      return rpc.start();
    };
  }

  // Setup the bindings to every method in the service signature list.
  signature.forEach(function(sig) {
    sig.methods.forEach(function(meth) {
      bindMethod(meth);
    });
  });

  Object.defineProperty(boundObject, '__signature', {
    value: signature,
    writable: false,
  });

  return boundObject;
};

/**
 * A callback that is called with either signature interfaces or an error.
 * @callback module:vanadium.rpc~Client~signatureCb
 * @param {Error} err If set, the error that occurred.
 * @param {module:vanadium.vdl.signature.Interface[]} signature The signature
 * interfaces.
 */
/**
 * Returns the object signatures for a given object name.
 * @param {module:vanadium.context.Context} ctx A context.
 * @param {string} name The vanadium name of the service to bind to.
 * @param {module:vanadium.rpc~Client~signatureCb} [cb] If given, this
 * function will be called on completion.
 * @return {Promise<module:vanadium.vdl.signature.Interface[]>} Promise that
 * will be resolved with the signature interfaces or rejected with an error
 * if there is one.
 */
Client.prototype.signature = function(ctx, name, cb) {
  var last = arguments.length - 1;

  // grab the callback
  if (typeof arguments[last] === 'function') {
    cb = arguments[last];
  }
  var deferred = new Deferred(cb);

  if (!(ctx instanceof context.Context)) {
    deferred.reject(new Error('First argument must be a Context object.'));
    return deferred.promise;
  }

  var cache = this._proxyConnection.signatureCache;
  var cacheEntry = cache.get(name);
  if (cacheEntry) {
    deferred.resolve(cacheEntry);
    return deferred.promise;
  }
  this._controller.signature(ctx, name).then(function(signature){
    cache.set(name, signature);
    deferred.resolve(signature);
  }).catch(function(err) {
    deferred.reject(err);
  });

  return deferred.promise;
};

/**
 * A callback that will be called on completion of the
 * [remoteBlessings]{@link module:vanadium.rpc~Client#remoteBlessings}
 * function.
 * @callback module:vanadium.rpc~Client~remoteBlessingsCb
 * @param {Error} err If set, the error that occurred.
 * @param {string[]} blessingNames The blessings of the remote server.
 */
/**
 * Returns the remote blessings of a server at the given name.
 * @param {module:vanadium.context.Context} ctx A context.
 * @param {string} name The vanadium name of the service to get the remote
 * blessings of.
 * @param {string} [method] The name of the rpc method that will be started in
 * order to read the blessings.  Defaults to 'Signature'.  This only matters in
 * the case when a server responds to different method calls with different
 * blessings.
 * @param {module:vanadium.rpc~Client~remoteBlessingsCb} [cb] If given, this
 * function will be called on completion.
 * @return {Promise<string[]>} Promise that will be resolved with the
 * blessing names or rejected with an error if there is one.
 */
Client.prototype.remoteBlessings = function(ctx, name, method, cb) {
  var last = arguments.length - 1;

  // grab the callback
  if (typeof arguments[last] === 'function') {
    cb = arguments[last];
  }

  // method defaults to Signature.
  if (typeof method !== 'string') {
    method = ReservedSignature;
  }

  return this._controller.remoteBlessings(ctx, name, method, cb);
};

/**
 * @summary Create a ClientCallOption object.
 *
 * @description <p>Client call options can be passed to a service method and
 * are used to configure the RPC call.  They are not passed to the Vanadium RPC
 * service.</p>
 *
 * <p>Supported keys are 'allowedServersPolicy' and 'granter'.</p>
 *
 * <p>Example of allowedServersPolicy option:</p>
 * <pre>
 * var callOpt = client.callOption({
 *   allowedServersPolicy: ['alice:home:tv']
 * });
 * service.get(ctx, 'foo', callOpt, function(err) {
 *   // err will be non-null if service's blessings do not match
 *   // ['alice:home:tv'].
 * });
 * </pre>
 *
 * <p>Example of granter option:</p>
 * <pre>
 * var ctx = runtime.getContext();
 * var granter = function(ctx, call, callback) {
 *   // Bless the server's public key with the extension 'ext' and 5 second
 *   // expiration caveat.
 *   var expCaveat = caveats.createExpiryCaveat(new Date(Date.now() + 5000));
 *   runtime.principal.bless(ctx, call.remoteBlessings.publicKey,
 *       call.localBlessings, 'ext', expCaveat, callback);
 * };
 *
 * var callOpt = client.callOption({
 *   granter: granter
 * });
 *
 * // Make a call on to the service.  Server will be granted blessing.
 * service.get(ctx, 'foo', callOpt, cb);
 * </pre>
 * @param {object} opts Map of call options.
 * @param {string[]} opts.allowedServersPolicy <p>Array of blessing patterns
 * that the allowed server must match in order for the RPC to be initiated.</p>
 * @param {module:vanadium.security~GranterFunction} opts.granter <p>A granter
 * function.</p>
 * @return {module:vanadium.rpc~Client~ClientCallOption}
 */
Client.prototype.callOption = function(opts) {
  // TODO(nlacasse): Support other CallOption types.
  var allowedOptions = ['allowedServersPolicy', 'granter'];

  // Validate opts.
  var keys = Object.keys(opts);
  keys.forEach(function(key) {
    if (allowedOptions.indexOf(key) < 0) {
      throw new verror.BadArgError(null, 'Invalid call option ' + key);
    }
  });

  return new ClientCallOption(opts);
};

/**
 * @summary ClientCallOption represents different configurations that can be
 * specified when making an RPC call.
 * @description
 * Private constructor, use
 * [client.callOption(opts)]{@link module:vanadium.rpc~Client#callOption}
 * to construct an instance.
 * @constructor
 * @inner
 * @memberof module:vanadium.rpc~Client
 */
function ClientCallOption(opts) {
  this.opts = opts;
}

/**
 * Convert ClientCallOption object to array of RpcCallOption VDL values.
 * @private
 * @return {Array} Array of RpcCallOption VDL values.
 */
ClientCallOption.prototype._toRpcCallOption = function(ctx, proxy) {
  var rpcCallOptions = [];
  var keys = Object.keys(this.opts);
  keys.forEach(function(key) {
    var opt = {};
    if (key === 'granter') {
      var runtime = ctx.value(SharedContextKeys.RUNTIME);
      var granterRouter = runtime._getGranterRouter();
      var fn = this.opts[key];
      var granterId = granterRouter.addGranter(fn);
      opt[key] = granterId;
    } else {
      opt[key] = this.opts[key];
    }
    rpcCallOptions.push(new RpcCallOption(opt));
  }, this);
  return rpcCallOptions;
};

/**
 * Export the module
 */
module.exports = Client;

}).call(this,require('_process'))
},{"../context":48,"../gen-vdl/v.io/v23/rpc":50,"../gen-vdl/v.io/v23/vdlroot/time":56,"../gen-vdl/v.io/v23/verror":57,"../gen-vdl/v.io/x/ref/services/wspr/internal/app":60,"../gen-vdl/v.io/x/ref/services/wspr/internal/principal":63,"../lib/deferred":69,"../lib/emit-stream-error":70,"../lib/promise":73,"../lib/task-sequence":76,"../lib/vlog":79,"../proxy/message-type":84,"../proxy/stream":87,"../runtime/runtime-from-context":104,"../runtime/shared-context-keys":105,"../vdl":133,"../vdl/byte-util":125,"../vdl/type-util":144,"../vdl/util":147,"../verror/actions":148,"../verror/make-errors":152,"../vom":165,"../vom/byte-message-writer":159,"../vom/encoder":164,"../vtrace":173,"_process":11}],90:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var createSecurityCall = require('../security/create-security-call');

module.exports = createServerCall;

/**
 * Create a server call object. This exists so that we can resolve blessings
 * before the user is given the object.
 * @private
 */
function createServerCall(request, blessingsCache) {
  var serverCall = new ServerCall();
  if (request instanceof ServerCall) {
    serverCall.securityCall = request.securityCall.clone();
    serverCall.grantedBlessings = request.grantedBlessings;
    return Promise.resolve(serverCall);
  } else {
    var promises = [];
    promises.push(createSecurityCall(request.call.securityCall,
      blessingsCache).then(function(securityCall) {
      serverCall.securityCall = securityCall;
    }));
    if (request.call.grantedBlessings) {
      promises.push(
        blessingsCache.blessingsFromId(request.call.grantedBlessings)
        .then(function(grantedBlessings) {
          serverCall.grantedBlessings = grantedBlessings;
        })
      );
    }
    return Promise.all(promises).then(function() {
      return serverCall;
    });
  }
}

/**
 * @summary
 * A ServerCall is a context.Context subclass that includes additional
 * information about an ongoing server call.
 * @description
 * <p>Private Constructor, an instance of ServerCall is passed to every service
 * method as the first argument.</p>
 * @inner
 * @constructor
 *
 * @property {module:vanadium.security~SecurityCall} securityCall The
 * Security Call for the request.
 *
 * @property {module:vanadium.security~Blessings} grantedBlessings The
 * blessings optionally granted to the server from the client through a
 * granter.
 *
 * @property {*} methodTags The tags attached to the method,
 * interface specification in VDL.
 *
 * @memberof module:vanadium.rpc
 */
function ServerCall() {
}

},{"../security/create-security-call":118}],91:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var Transform = require('stream').Transform;
var inherits = require('inherits');

module.exports = GlobStream;

function GlobStream() {
  if (!(this instanceof GlobStream)) {
    return new GlobStream();
  }
  Transform.call(this, { objectMode: true});
}

inherits(GlobStream, Transform);


GlobStream.prototype._transform = function(data, encoding, callback) {
  callback(null, data);
};

},{"inherits":32,"stream":25}],92:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


var minimatch = require('minimatch');
module.exports = Glob;

var minimatchOptions = {
  nobrace: true,
  noext: true,
  nonegate: true,
};

function Glob(pattern) {
  if (typeof pattern !== 'string') {
    throw new Error('pattern needs to be a string, not a ' +
                    (typeof pattern));
  }
  if (!(this instanceof Glob)) {
    return new Glob(pattern);
  }

  this.elems = [];
  this.recursive = false;
  this.restricted = false;
  if (pattern !== '') {
    this.elems = pattern.split('/');
    var lastIndex = this.elems.length - 1;
    if (this.elems[lastIndex] === '...') {
      this.recursive = true;
      this.elems = this.elems.slice(0, lastIndex);
    } else if (this.elems[lastIndex] === '***') {
      this.recursive = true;
      this.restricted = true;
      this.elems = this.elems.slice(0, lastIndex);
    }
  }
  // TODO(bjornick): Make sure that the glob input is actually valid.
  // We don't need to do this now, but we do need to do it once we move
  // more of the rpc implementation to JS.
  this.patterns = this.elems.map(function(elem) {
    return minimatch.makeRe(elem, minimatchOptions);
  });
}

Glob.prototype.length = function() {
  return this.elems.length;
};

Glob.prototype.finished = function() {
  return this.length() === 0 && !this.recursive;
};

Glob.prototype.matchInitialSegment = function(elem) {
  if (this.length() === 0) {
    if (!this.recursive) {
      return { match: false, remainder: null};
    }
    return {match: true, remainder: this};
  }

  if (this.patterns[0].test(elem)) {
    return { match: true, remainder: stripFirstPath(this)};
  }

  return { match: false };
};

Glob.prototype.toString = function() {
  var pat = this.elems.join('/');
  if (this.recursive) {
    if (pat !== '') {
      pat += '/';
    }
    pat += '...';
  }
  return pat;
};

function stripFirstPath(glob) {
  var g = new Glob('');
  g.elems = glob.elems.slice(1);
  g.patterns = glob.patterns.slice(1);
  g.recursive = glob.recursive;
  return g;
}

},{"minimatch":35}],93:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.


var asyncCall = require('../lib/async-call');
var Promise = require('../lib/promise');
var vom = require('../vom');
var byteUtil = require('../vdl/byte-util');
var hexVom = require('../lib/hex-vom');
var verror = require('../gen-vdl/v.io/v23/verror');
var MessageType = require('../proxy/message-type');
var Incoming = MessageType.Incoming;
var Outgoing = MessageType.Outgoing;
var createSecurityCall = require('../security/create-security-call');
var InspectableFunction = require('../lib/inspectable-function');
var GranterResponse =
require('../gen-vdl/v.io/x/ref/services/wspr/internal/app').GranterResponse;
var vlog = require('./../lib/vlog');

module.exports = GranterRouter;

/**
 * A granter router handles granter requests and maintains a table of active
 * grant requests.
 * @private
 */
function GranterRouter(proxy, rootCtx, blessingsCache) {
  proxy.addIncomingHandler(Incoming.GRANTER_REQUEST, this);

  this._proxy = proxy;
  this._rootCtx = rootCtx;
  this.nextGranterId = 0;
  this.activeGranters = {};
  this._blessingsCache = blessingsCache;
}

/**
 * Handle incoming grant requests.
 * @private
 */
GranterRouter.prototype.handleRequest = function(messageId, type, request) {
  if (type !== Incoming.GRANTER_REQUEST) {
    vlog.logger.error('Expected granter request type but got ' + type);
    return;
  }


  try {
   request = byteUtil.hex2Bytes(request);
  } catch (e) {
    returnFailure(
      new verror.NoExistError(this._rootCtx, 'failed to decode message'));
    return Promise.resolve();
  }

  var router = this;
  var granter;
  return vom.decode(request).then(function(request) {
    request = request.val;
    granter = router.activeGranters[request.granterHandle];
    if (!granter) {
      // TODO(bjornick): Pass in context here so we can generate useful error
      // messages
      return Promise.reject(
        new verror.NoExistError(router._rootCtx, 'unknown granter'));
    }
    delete router.activeGranters[request.granterHandle];
    return createSecurityCall(request.call, router._blessingsCache);
  }, function(e) {
    return Promise.reject(
      new verror.NoExistError(router._rootCtx, 'failed to decode message'));
  }).then(function(securityCall) {
    var ctx = router._rootCtx;
    var inspectFn = new InspectableFunction(granter);
    var resolve;
    var reject;
    var promise = new Promise(function(a, b) {
      resolve = a;
      reject = b;
    });
    asyncCall(ctx, null, inspectFn, ['outBlessings'],
              [ctx, securityCall], function(err, res) {
                if(err) {
                  return reject(err);
                }
                return resolve(res);
              });
    return promise;
  }).then(function(outBlessings) {
    var result = new GranterResponse({blessings: outBlessings[0]});
    var data = hexVom.encode(result);
    router._proxy.sendRequest(data, Outgoing.GRANTER_RESPONSE, null,
      messageId);
  }, function(e) {
    return Promise.reject(
      new verror.NoExistError(router._rootCtx, 'error while granting: ' + e));
  }).catch(returnFailure);

  function returnFailure(e) {
    var res = new GranterResponse({err: e});
    var data = byteUtil.bytes2Hex(vom.encode(res));
    router._proxy.sendRequest(data, Outgoing.GRANTER_RESPONSE,
        null, messageId);
  }
};

/**
 * Register a granter to be used with a call and generate an id representing
 * the javascript function.
 * @private
 */
GranterRouter.prototype.addGranter = function(granterFn) {
  // Create an id corresponding to the callback and send the id
  this.nextGranterId++;

  this.activeGranters[this.nextGranterId] = granterFn;
  return this.nextGranterId;
};

},{"../gen-vdl/v.io/v23/verror":57,"../gen-vdl/v.io/x/ref/services/wspr/internal/app":60,"../lib/async-call":67,"../lib/hex-vom":71,"../lib/inspectable-function":72,"../lib/promise":73,"../proxy/message-type":84,"../security/create-security-call":118,"../vdl/byte-util":125,"../vom":165,"./../lib/vlog":79}],94:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @summary
 * Namespace rpc defines the public interface for all
 * interprocess communication.
 * @description
 * <p>Namespace rpc defines the public interface for all
 * interprocess communication.</p>
 *
 * <p>There are two actors in the system,
 * [clients]{@link module:vanadium.rpc~Client} and
 * [servers]{@link module:vanadium.rpc~Server}. Clients invoke
 * methods on Servers, using the bindTo method provided by the Client
 * interface. Servers implement methods on named objects. The named object is
 * found using a [Dispatcher]{@link Dispatcher}, and the method is invoked using
 * an Invoker.</p>
 * <p>Instances of the [Runtime]{@link module:vanadium~Runtime} host
 * Clients and Servers, such instances may
 * simultaneously host both Clients and Servers. The Runtime allows multiple
 * names to be simultaneously supported via the Dispatcher interface.</p>
 *
 * <p>The [naming]{@link module:vanadium.naming} namespace provides a
 * rendezvous mechanism for
 * Clients and Servers. In particular, it allows Runtimes hosting Servers to
 * share Endpoints with Clients that enables communication between them.
 * Endpoints encode sufficient addressing information to enable
 * communication.</p>
 * @memberof module:vanadium
 * @namespace rpc
 */

module.exports = {
  /**
   * @summary
   * Namespace reserved defines interfaces for interacting with reserved RPC
   * methods such as Signature, MethodSignature and Glob.
   * @memberof module:vanadium.rpc
   * @namespace reserved
   */
  reserved: require('../gen-vdl/v.io/v23/rpc/reserved'),
  serverOption: require('./server-option')
};
},{"../gen-vdl/v.io/v23/rpc/reserved":51,"./server-option":96}],95:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoveriew A leaf dispatcher that uses a single service object for
 * all suffixes
 */

/**
 * Returns a dispatcher function that will reuse the same service object
 * for all suffixes.
 * @private
 * @param {Service} service Service object.
 * @param {Authorizer} [authorizer] Optional authorizer to use.
 * @return {function} A dispatcher function that will reuse the same service
 * object.
 */
function createLeafDispatcher(service, authorizer) {
  var dispatcher = function() {
    return {
      service: service,
      authorizer: authorizer,
    };
  };
  dispatcher._isLeaf = true;
  return dispatcher;
}

/**
 * Export module
 */
module.exports = createLeafDispatcher;

},{}],96:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var RpcServerOption =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/app').RpcServerOption;
var verror = require('../gen-vdl/v.io/v23/verror');

module.exports = serverOption;

/**
 * Creates serverOption that can be passed to
 * [runtime.newServer(serverOptions)]{@link module:vanadium~Runtime#newServer}
 * to specify different server configurations.
 * @param {object} opts Server options.
 * @param {bool} opts.isLeaf Indicates server will be used to serve a leaf
 * service. This option is automatically set to true if
 * [rt.newServer()]{@link module:vanadium~Runtime#newServer} is used.
 * but defaults to false if [rt.newDispatchingServer()]
 * {@link module:vanadium~Runtime#newDispatchingServer} is used.
 * @param {bool} opts.servesMountTable Indicates server will be used to serve
 * a MountTable. This server cannot be used for any other purpose.
 * @return {module:vanadium.rpc~Server~ServerOption}
 * @memberof module:vanadium.rpc
 */
function serverOption(opts) {
  opts = opts || {};
  var allowedOptions = ['isLeaf', 'servesMountTable'];
  // Validate opts.
  var keys = Object.keys(opts);
  keys.forEach(function(key) {
    if (allowedOptions.indexOf(key) < 0) {
      throw new verror.BadArgError(null, 'Invalid server option ' + key);
    }
  });

  return new ServerOption(opts);
}

/**
 * @summary ServerOption represents different configurations that can be
 * specified when creating a new server.
 * @description
 * Private constructor, use
 * [vanadium.rpc.serverOption(opts)]{@link module:vanadium.rpc.serverOption}
 * to construct an instance.
 * @constructor
 * @memberof module:vanadium.rpc~Server
 * @inner
 */
function ServerOption(opts) {
  opts = opts || {};
  var allowedOptions = ['isLeaf', 'servesMountTable'];
  // Validate opts.
  var keys = Object.keys(opts);
  keys.forEach(function(key) {
    if (allowedOptions.indexOf(key) < 0) {
      throw new verror.BadArgError(null, 'Invalid server option ' + key);
    }
  });

  this._opts = opts;
}

/**
 * Convert ServerOption object to array of RpcCallOption VDL values.
 * @private
 * @return {Array} Array of RpcServerOption VDL values.
 */
ServerOption.prototype._toRpcServerOption = function(ctx, proxy) {
  var rpcCallOptions = [];
  var keys = Object.keys(this._opts);
  keys.forEach(function(key) {
    var opt = {};
    opt[key] = this._opts[key];
    rpcCallOptions.push(new RpcServerOption(opt));
  }, this);
  return rpcCallOptions;
};
},{"../gen-vdl/v.io/v23/verror":57,"../gen-vdl/v.io/x/ref/services/wspr/internal/app":60}],97:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoveriew A router that handles incoming server rpcs.
 * @private
 */

var Promise = require('../lib/promise');
var Stream = require('../proxy/stream');
var MessageType = require('../proxy/message-type');
var Incoming = MessageType.Incoming;
var Outgoing = MessageType.Outgoing;
var ErrorConversion = require('../vdl/error-conversion');
var vlog = require('./../lib/vlog');
var StreamHandler = require('../proxy/stream-handler');
var verror = require('../gen-vdl/v.io/v23/verror');
var createSecurityCall = require('../security/create-security-call');
var createServerCall = require('./create-server-call');
var vdl = require('../vdl');
var typeUtil = require('../vdl/type-util');
var Deferred = require('../lib/deferred');
var capitalize = require('../vdl/util').capitalize;
var namespaceUtil = require('../naming/util');
var naming = require('../gen-vdl/v.io/v23/naming');
var Glob = require('./glob');
var GlobStream = require('./glob-stream');
var ServerRpcReply =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/lib').ServerRpcReply;
var serverVdl =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/rpc/server');
var CaveatValidationResponse = serverVdl.CaveatValidationResponse;
var AuthReply = serverVdl.AuthReply;
var LookupReply = serverVdl.LookupReply;
var vtrace = require('../vtrace');
var lib =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/lib');
var Blessings = require('../security/blessings');
var BlessingsId =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/principal').BlessingsId;
var WireBlessings =
  require('../gen-vdl/v.io/v23/security').WireBlessings;
var SharedContextKeys = require('../runtime/shared-context-keys');
var hexVom = require('../lib/hex-vom');
var vom = require('../vom');
var byteUtil = require('../vdl/byte-util');
var StreamCloseHandler = require('./stream-close-handler');

/**
 * A router that handles routing incoming requests to the right
 * server
 * @constructor
 * @private
 */
var Router = function(
  proxy, appName, rootCtx, controller, caveatRegistry, blessingsCache) {
  this._servers = {};
  this._proxy = proxy;
  this._streamMap = {};
  this._contextMap = {};
  this._appName = appName;
  this._rootCtx = rootCtx;
  this._caveatRegistry = caveatRegistry;
  this._outstandingRequestForId = {};
  this._controller = controller;
  this._blessingsCache = blessingsCache;
  this._typeEncoder = proxy.typeEncoder;
  this._typeDecoder = proxy.typeDecoder;

  proxy.addIncomingHandler(Incoming.INVOKE_REQUEST, this);
  proxy.addIncomingHandler(Incoming.LOOKUP_REQUEST, this);
  proxy.addIncomingHandler(Incoming.AUTHORIZATION_REQUEST, this);
  proxy.addIncomingHandler(Incoming.CAVEAT_VALIDATION_REQUEST, this);
  proxy.addIncomingHandler(Incoming.LOG_MESSAGE, this);
};

Router.prototype.handleRequest = function(messageId, type, request) {
  switch (type) {
    case Incoming.INVOKE_REQUEST:
      return this.handleRPCRequest(messageId, request);
    case Incoming.LOOKUP_REQUEST:
      this.handleLookupRequest(messageId, request);
      break;
    case Incoming.AUTHORIZATION_REQUEST:
      this.handleAuthorizationRequest(messageId, request);
      break;
    case Incoming.CAVEAT_VALIDATION_REQUEST:
      this.handleCaveatValidationRequest(messageId, request);
      break;
    case Incoming.LOG_MESSAGE:
      if (request.level === typeUtil.unwrap(lib.LogLevel.INFO)) {
        vlog.logger.info(request.message);
      } else if (request.level === typeUtil.unwrap(lib.LogLevel.ERROR)) {
        vlog.logger.error(request.message);
      } else {
        vlog.logger.error('unknown log level ' + request.level);
      }
      break;
    default:
      vlog.logger.error('Unknown request type ' + type);
  }
};

Router.prototype.handleAuthorizationRequest = function(messageId, request) {
  try {
    request = byteUtil.hex2Bytes(request);
  } catch (e) {
    var authReply = new AuthReply({
      // TODO(bjornick): Use the real context
      err: new verror.InternalError(this._rootCtx, 'Failed to decode ', e)
    });

    this._proxy.sendRequest(hexVom.encode(authReply, undefined,
        this._typeEncoder),
      Outgoing.AUTHORIZATION_RESPONSE, null, messageId);
    return;
  }

  var router = this;
  var decodedRequest;
  vom.decode(request, false, this._typeDecoder).catch(function(e) {
    return Promise.reject(new verror.InternalError(router._rootCtx,
      'Failed to decode ', e));
  }).then(function(req) {
    decodedRequest = req;
    var ctx = router._rootCtx.withValue(SharedContextKeys.LANG_KEY,
      decodedRequest.context.language);
    var server = router._servers[decodedRequest.serverId];
    if (!server) {
      var authReply = new AuthReply({
        // TODO(bjornick): Use the real context
        err: new verror.ExistsError(ctx, 'unknown server')
      });
      var bytes = hexVom.encode(authReply, undefined, router._typeEncoder);
      router._proxy.sendRequest(bytes,
        Outgoing.AUTHORIZATION_RESPONSE,
        null, messageId);
      return;
    }
    return createSecurityCall(decodedRequest.call, router._blessingsCache)
      .then(function(call) {
        return server._handleAuthorization(decodedRequest.handle, ctx, call);
      });
  }).then(function() {
    var authReply = new AuthReply({});
    router._proxy.sendRequest(hexVom.encode(authReply, undefined,
        router._typeEncoder),
      Outgoing.AUTHORIZATION_RESPONSE, null, messageId);
  }).catch(function(e) {
    var authReply = new AuthReply({
      err: ErrorConversion.fromNativeValue(e, router._appName,
        decodedRequest.call.method)
    });
    router._proxy.sendRequest(hexVom.encode(authReply, undefined,
        router._typeEncoder),
      Outgoing.AUTHORIZATION_RESPONSE, null,
      messageId);
  });
};

Router.prototype._validateChain = function(ctx, call, cavs) {
  var router = this;
  var promises = cavs.map(function(cav) {
    var def = new Deferred();
    router._caveatRegistry.validate(ctx, call, cav, function(err) {
      if (err) {
        return def.reject(err);
      }
      return def.resolve();
    });
    return def.promise;
  });
  return Promise.all(promises).then(function(results) {
    return undefined;
  }).catch(function(err) {
    if (!(err instanceof Error)) {
      err = new Error(
        'Non-error value returned from caveat validator: ' +
        err);
    }
    return ErrorConversion.fromNativeValue(err, router._appName,
      'caveat validation');
  });
};

Router.prototype.handleCaveatValidationRequest = function(messageId, request) {
  var router = this;
  createSecurityCall(request.call, this._blessingsCache)
    .then(function(call) {
      var ctx = router._rootCtx.withValue(SharedContextKeys.LANG_KEY,
        request.context.language);
      var resultPromises = request.cavs.map(function(cav) {
        return router._validateChain(ctx, call, cav);
      });
      return Promise.all(resultPromises).then(function(results) {
        var response = new CaveatValidationResponse({
          results: results
        });
        var data = hexVom.encode(response, undefined, router._typeEncoder);
        router._proxy.sendRequest(data, Outgoing.CAVEAT_VALIDATION_RESPONSE,
          null, messageId);
      });
    }).catch(function(err) {
      vlog.logger.error('Got err ' + err + ': ' + err.stack);
      throw new Error('Unexpected error (all promises should resolve): ' + err);
    });
};

Router.prototype.handleLookupRequest = function(messageId, request) {
  var server = this._servers[request.serverId];
  if (!server) {
    // TODO(bjornick): Pass in context here so we can generate useful error
    // messages.
    var reply = new LookupReply({
      err: new verror.NoExistError(this._rootCtx, 'unknown server')
    });
    this._proxy.sendRequest(hexVom.encode(reply, undefined, this._typeEncoder),
      Outgoing.LOOKUP_RESPONSE,
      null, messageId);
    return;
  }

  var self = this;
  return server._handleLookup(request.suffix).then(function(value) {
    var signatureList = value.invoker.signature();
    var hasAuthorizer = (typeof value.authorizer === 'function');
    var hasGlobber = value.invoker.hasGlobber();
    var reply = {
      handle: value._handle,
      signature: signatureList,
      hasAuthorizer: hasAuthorizer,
      hasGlobber: hasGlobber
    };
    self._proxy.sendRequest(hexVom.encode(reply, LookupReply.prototype._type,
        self._typeEncoder),
      Outgoing.LOOKUP_RESPONSE,
      null, messageId);
  }).catch(function(err) {
    var reply = new LookupReply({
      err: ErrorConversion.fromNativeValue(err, self._appName, '__Signature')
    });
    self._proxy.sendRequest(hexVom.encode(reply, undefined, self._typeEncoder),
      Outgoing.LOOKUP_RESPONSE,
      null, messageId);
  });
};

Router.prototype.createRPCContext = function(request) {
  var ctx = this._rootCtx;
  // Setup the context passed in the context info passed in from wspr.
  if (!request.call.deadline.noDeadline) {
    var fromNow = request.call.deadline.fromNow;
    var timeout = fromNow.seconds * 1000;
    timeout += fromNow.nanos / 1000000;
    ctx = ctx.withTimeout(timeout);
  } else {
    ctx = ctx.withCancel();
  }
  ctx = ctx.withValue(SharedContextKeys.LANG_KEY,
    request.call.context.language);
  // Plumb through the vtrace ids
  var suffix = request.call.securityCall.suffix;
  var spanName = '<jsserver>"' + suffix + '".' + request.method;
  // TODO(mattr): We need to enforce some security on trace responses.
  return vtrace.withContinuedTrace(ctx, spanName,
    request.call.traceRequest);
};

function getMethodSignature(invoker, methodName) {
  var methodSig;
  // Find the method signature.
  var signature = invoker.signature();
  signature.forEach(function(ifaceSig) {
    ifaceSig.methods.forEach(function(method) {
      if (method.name === methodName) {
        methodSig = method;
      }
    });
  });
  return methodSig;
}

Router.prototype._setupStream = function(messageId, ctx, methodSig) {
  this._contextMap[messageId] = ctx;
  if (methodIsStreaming(methodSig)) {
    var readType = (methodSig.inStream ? methodSig.inStream.type : null);
    var writeType = (methodSig.outStream ? methodSig.outStream.type : null);
    var stream = new Stream(messageId, this._proxy.senderPromise, false,
      readType, writeType, this._typeEncoder);
    this._streamMap[messageId] = stream;
    var rpc = new StreamHandler(ctx, stream, this._typeDecoder);
    this._proxy.addIncomingStreamHandler(messageId, rpc);
  } else {
    this._proxy.addIncomingStreamHandler(messageId,
      new StreamCloseHandler(ctx));
  }
};

var globSig = {
  inArgs: [],
  outArgs: [],
  outStream: {
    type: naming.GlobReply.prototype._type
  }
};

/**
 * Handles the processing for reserved methods.  If this request is not
 * a reserved method call, this method does nothing.
 *
 * @private
 * @param {module:vanadium.context.Context} ctx The context of the request
 * @param {number} messageId The flow id
 * @param {module:vanadium.rpc~Server} server The server instance that is
 * handling the request.
 * @param {Invoker} invoker The invoker for this request
 * @param {string} methodName The name of the method.
 * @param {object} request The request
 * @returns Promise A promise that will be resolved when the method is
 * dispatched or null if this is not a reserved method
 */
Router.prototype._maybeHandleReservedMethod = function(
  ctx, messageId, server, invoker, methodName, request) {
  var self = this;

  function globCompletion() {
    // There are no results to a glob method.  Everything is sent back
    // through the stream.
    self.sendResult(messageId, methodName, null, undefined, 1);
  }

  if (request.method === 'Glob__') {
    if (!invoker.hasGlobber()) {
      var err = new Error('Glob is not implemented');
      this.sendResult(messageId, 'Glob__', null, err);
      return;
    }

    this._setupStream(messageId, ctx, globSig);
    this._outstandingRequestForId[messageId] = 0;
    this.incrementOutstandingRequestForId(messageId);
    var globPattern = typeUtil.unwrap(request.args[0]);
    return createServerCall(request, this._blessingsCache)
      .then(function(call) {
        self.handleGlobRequest(messageId, call.securityCall.suffix,
          server, new Glob(globPattern), ctx, call, invoker,
          globCompletion);
      });
  }
  return null;
};

Router.prototype._unwrapArgs = function(args, methodSig) {
  var self = this;
  // Unwrap the RPC arguments sent to the JS server.
  var unwrappedArgPromises = args.map(function(arg, i) {
    // If an any type was expected, unwrapping is not needed.
    if (methodSig.inArgs[i].type.kind === vdl.kind.ANY) {
      return Promise.resolve(arg);
    }
    var unwrapped = typeUtil.unwrap(arg);
    if (unwrapped instanceof BlessingsId) {
      return self._blessingsCache.blessingsFromId(unwrapped);
    }
    return Promise.resolve(unwrapped);
  });
  return Promise.all(unwrappedArgPromises);
};

/**
 * Performs the rpc request.  Unlike handleRPCRequest, this function works on
 * the decoded message.
 * @private
 * @param {number} messageId Message Id set by the server.
 * @param {Object} request Request's structure is
 * {
 *   serverId: number // the server id
 *   method: string // Name of the method on the service to call
 *   args: [] // Array of positional arguments to be passed into the method
 *            // Note: This array contains wrapped arguments!
 * }
 */
Router.prototype._handleRPCRequestInternal = function(messageId, request) {
  var methodName = capitalize(request.method);
  var server = this._servers[request.serverId];
  var err;

  if (!server) {
    // TODO(bprosnitz) What error type should this be.
    err = new Error('Request for unknown server ' + request.serverId);
    this.sendResult(messageId, methodName, null, err);
    return;
  }

  var invoker = server._getInvokerForHandle(request.handle);
  if (!invoker) {
    vlog.logger.error('No invoker found: ', request);
    err = new Error('No service found');
    this.sendResult(messageId, methodName, null, err);
    return;
  }

  var ctx = this.createRPCContext(request);

  var reservedPromise = this._maybeHandleReservedMethod(
    ctx, messageId, server, invoker, methodName, request);

  if (reservedPromise) {
    return;
  }

  var self = this;
  var methodSig = getMethodSignature(invoker, methodName);

  if (methodSig === undefined) {
    err = new verror.NoExistError(
      ctx, 'Requested method', methodName, 'not found on');
    this.sendResult(messageId, methodName, null, err);
    return;
  }

  this._setupStream(messageId, ctx, methodSig);
  var args;
  this._unwrapArgs(request.args, methodSig).then(function(unwrapped) {
    args = unwrapped;
    return createServerCall(request, self._blessingsCache);
  }).then(function(call) {
    var options = {
      methodName: methodName,
      args: args,
      methodSig: methodSig,
      ctx: ctx,
      call: call,
      stream: self._streamMap[messageId],
    };

    // Invoke the method;
    self.invokeMethod(invoker, options).then(function(results) {
      // Has results; associate the types of the outArgs.
      var canonResults = results.map(function(result, i) {
        var t = methodSig.outArgs[i].type;
        if (t.equals(WireBlessings.prototype._type)) {
          if (!(result instanceof Blessings)) {
            vlog.logger.error(
              'Encoding non-blessings value as wire blessings');
            return null;
          }
          return result;
        }
        return vdl.canonicalize.fill(result, t);
      });
      self.sendResult(messageId, methodName, canonResults, undefined,
        methodSig.outArgs.length);
    }, function(err) {
      var stackTrace;
      if (err instanceof Error && err.stack !== undefined) {
        stackTrace = err.stack;
      }
      vlog.logger.error('Requested method ' + methodName +
        ' threw an exception on invoke: ', err, stackTrace);

      // The error case has no results; only send the error.
      self.sendResult(messageId, methodName, undefined, err,
        methodSig.outArgs.length);
    });
  });
};
/**
 * Handles incoming requests from the server to invoke methods on registered
 * services in JavaScript.
 * @private
 * @param {string} messageId Message Id set by the server.
 * @param {string} vdlRequest VOM encoded request. Request's structure is
 * {
 *   serverId: number // the server id
 *   method: string // Name of the method on the service to call
 *   args: [] // Array of positional arguments to be passed into the method
 *            // Note: This array contains wrapped arguments!
 * }
 */
Router.prototype.handleRPCRequest = function(messageId, vdlRequest) {
  var err;
  var request;
  var router = this;
  try {
    request = byteUtil.hex2Bytes(vdlRequest);
  } catch (e) {
    err = new Error('Failed to decode args: ' + e);
    this.sendResult(messageId, '', null, err);
    return;
  }
  return vom.decode(request, false, this._typeDecoder)
    .then(function(request) {
      return router._handleRPCRequestInternal(messageId, request);
    }, function(e) {
      vlog.logger.error('Failed to decode args : ' + e + ': ' + e.stack);
      err = new Error('Failed to decode args: ' + e);
      router.sendResult(messageId, '', null, err);
    });
};

function methodIsStreaming(methodSig) {
  return (typeof methodSig.inStream === 'object' &&
    methodSig.inStream !== null) || (typeof methodSig.outStream === 'object' &&
    methodSig.outStream !== null);
}

/**
 * Invokes a method with a methodSig
 */
Router.prototype.invokeMethod = function(invoker, options) {
  var methodName = options.methodName;
  var args = options.args;
  var ctx = options.ctx;
  var call = options.call;

  var injections = {
    context: ctx,
    call: call,
    stream: options.stream
  };

  var def = new Deferred();

  function InvocationFinishedCallback(err, results) {
    if (err) {
      return def.reject(err);
    }
    def.resolve(results);
  }

  invoker.invoke(methodName, args, injections, InvocationFinishedCallback);
  return def.promise;
};

function createGlobReply(name) {
  name = name || '';
  return new naming.GlobReply({
    'entry': new naming.MountEntry({
      name: name
    })
  });
}

function createGlobErrorReply(name, err, appName) {
  name = name || '';
  var convertedError = ErrorConversion.fromNativeValue(err, appName, 'glob');
  return new naming.GlobReply({
    'error': new naming.GlobError({
      name: name,
      error: convertedError
    })
  });
}

Router.prototype.handleGlobRequest = function(messageId, name, server, glob,
  context, call, invoker, cb) {
  var self = this;
  var options;

  function invokeAndCleanup(invoker, options, method) {
    self.invokeMethod(invoker, options).catch(function(err) {
      var verr = new verror.InternalError(context,
        method + '() failed', glob, err);
      var errReply = createGlobErrorReply(name, verr, self._appName);
      self._streamMap[messageId].write(errReply);
      vlog.logger.info(verr);
    }).then(function() {
      // Always decrement the outstanding request counter.
      self.decrementOutstandingRequestForId(messageId, cb);
    });
  }
  if (invoker.hasMethod('__glob')) {
    options = {
      methodName: '__glob',
      args: [glob.toString()],
      methodSig: {
        outArgs: []
      },
      ctx: context,
      call: call,
      // For the __glob method we just write the
      // results directly out to the rpc stream.
      stream: this._streamMap[messageId]
    };
    invokeAndCleanup(invoker, options, '__glob');
  } else if (invoker.hasMethod('__globChildren')) {
    if (glob.length() === 0) {
      // This means we match the current object.
      this._streamMap[messageId].write(createGlobReply(name));
    }

    if (glob.finished()) {
      this.decrementOutstandingRequestForId(messageId, cb);
      return;
    }
    // Create a GlobStream
    var globStream = new GlobStream();
    options = {
      methodName: '__globChildren',
      args: [],
      methodSig: {
        outArgs: []
      },
      ctx: context,
      call: call,
      stream: globStream
    };
    globStream.on('data', function(child) {
      // TODO(bjornick): Allow for escaped slashes.
      if (child.indexOf('/') !== -1) {
        var verr = new verror.InternalError(context,
          '__globChildren returned a bad child', child);
        var errReply = createGlobErrorReply(name, verr, self._appName);
        self._streamMap[messageId].write(errReply);
        vlog.logger.info(verr);
        return;
      }

      var suffix = namespaceUtil.join(name, child);
      self.incrementOutstandingRequestForId(messageId);
      var nextInvoker;
      var subCall;
      createServerCall(call, this._blessingsCache).then(function(servCall) {
        subCall = servCall;
        subCall.securityCall.suffix = suffix;
        return server._handleLookup(suffix);
      }).then(function(value) {
        nextInvoker = value.invoker;
        return server._handleAuthorization(value._handle, context,
          subCall.securityCall);
      }).then(function() {
        var match = glob.matchInitialSegment(child);
        if (match.match) {
          self.handleGlobRequest(messageId, suffix, server, match.remainder,
            context, subCall, nextInvoker, cb);
        } else {
          self.decrementOutstandingRequestForId(messageId, cb);
        }
      }).catch(function(e) {
        var verr = new verror.NoServersError(context, suffix, e);
        var errReply = createGlobErrorReply(suffix, verr, self._appName);
        self._streamMap[messageId].write(errReply);
        vlog.logger.info(errReply);
        self.decrementOutstandingRequestForId(messageId, cb);
      });
    });

    invokeAndCleanup(invoker, options, '__globChildren');
  } else {
    // This is a leaf of the globChildren call so we return this as
    // a result.
    this._streamMap[messageId].write(createGlobReply(name));

    this.decrementOutstandingRequestForId(messageId, cb);
  }
};

Router.prototype.incrementOutstandingRequestForId = function(id) {
  this._outstandingRequestForId[id]++;
};

Router.prototype.decrementOutstandingRequestForId = function(id, cb) {
  this._outstandingRequestForId[id]--;
  if (this._outstandingRequestForId[id] === 0) {
    cb();
    delete this._outstandingRequestForId[id];
  }
};

/**
 * Sends the result of a requested invocation back to jspr
 * @private
 * @param {number} messageId Message id of the original invocation request
 * @param {string} name Name of method
 * @param {Object} results Result of the call
 * @param {Error} err Error from the call
 */
Router.prototype.sendResult = function(messageId, name, results, err,
  numOutArgs) {
  if (!results) {
    results = new Array(numOutArgs);
  }

  var errorStruct = null;
  if (err !== undefined && err !== null) {
    errorStruct = ErrorConversion.fromNativeValue(err, this._appName,
      name);
  }

  // Clean up the context map.
  var ctx = this._contextMap[messageId];
  if (ctx) {
    ctx.finish();
    delete this._contextMap[messageId];
  }

  var traceResponse = vtrace.response(ctx);

  // If this is a streaming request, queue up the final response after all
  // the other stream requests are done.
  var stream = this._streamMap[messageId];
  if (stream && typeof stream.serverClose === 'function') {
    // We should probably remove the stream from the dictionary, but it's
    // not clear if there is still a reference being held elsewhere.  If there
    // isn't, then GC might prevent this final message from being sent out.
    stream.serverClose(results, errorStruct, traceResponse);
    this._proxy.dequeue(messageId);
  } else {
    var responseData = new ServerRpcReply({
      results: results,
      err: errorStruct,
      traceResponse: traceResponse
    });
    this._proxy.sendRequest(hexVom.encode(responseData, undefined,
        this._typeEncoder),
      Outgoing.RESPONSE,
      null, messageId);
  }
};

/**
 * Instructs WSPR to create a server and start listening for calls on
 * behalf of the given JavaScript server.
 * @private
 * @param {string} name Name to serve under
 * @param {Vanadium.Server} server The server who will handle the requests for
 * this name.
 * @param {function} [cb] If provided, the function will be called when
 * serve completes.  The first argument passed in is the error if there
 * was any.
 * @return {Promise} Promise to be called when serve completes or fails.
 */
Router.prototype.newServer = function(name, server, cb) {
  vlog.logger.info('New server under the name: ', name);
  this._servers[server.id] = server;
  // If using a leaf dispatcher, set the IsLeaf ServerOption.
  var isLeaf = server.dispatcher && server.dispatcher._isLeaf;
  if (isLeaf) {
    server.serverOption._opts.isLeaf = true;
  }
  var rpcOpts = server.serverOption._toRpcServerOption();
  return this._controller.newServer(this._rootCtx, name, server.id,
    rpcOpts, cb);
};

/**
 * Sends an addName request to jspr.
 * @private
 * @param {string} name Name to publish
 * @param {function} [cb] If provided, the function will be called on
 * completion. The only argument is an error if there was one.
 * @return {Promise} Promise to be called when operation completes or fails
 */
Router.prototype.addName = function(name, server, cb) {
  return this._controller.addName(this._rootCtx, server.id, name, cb);
};

/**
 * Sends an removeName request to jspr.
 * @private
 * @param {string} name Name to unpublish
 * @param {function} [cb] If provided, the function will be called on
 * completion. The only argument is an error if there was one.
 * @return {Promise} Promise to be called when operation completes or fails
 */
Router.prototype.removeName = function(name, server, cb) {
  // Delete our bind cache entry for that name
  this._proxy.signatureCache.del(name);
  return this._controller.removeName(this._rootCtx, server.id, name, cb);
};

/**
 * Sends a stop server request to jspr.
 * @private
 * @param {Server} server Server object to stop.
 * @param {function} [cb] If provided, the function will be called on
 * completion. The only argument is an error if there was one.
 * @return {Promise} Promise to be called when stop service completes or fails
 */
Router.prototype.stopServer = function(server, cb) {
  var self = this;

  return this._controller.stop(this._rootCtx, server.id)
    .then(function() {
      delete self._servers[server.id];
      if (cb) {
        cb(null);
      }
    }, function(err) {
      if (cb) {
        cb(err);
      }
      return Promise.reject(err);
    });
};

/**
 * Stops all servers managed by this router.
 * @private
 * @param {function} [cb] If provided, the function will be called on
 * completion. The only argument is an error if there was one.
 * @return {Promise} Promise to be called when all servers are stopped.
 */
Router.prototype.cleanup = function(cb) {
  var promises = [];
  var servers = this._servers;
  for (var id in servers) {
    if (servers.hasOwnProperty(id)) {
      promises.push(this.stopServer(servers[id]));
    }
  }
  return Promise.all(promises).then(function() {
    if (cb) {
      cb(null);
    }
  }, function(err) {
    if (cb) {
      cb(err);
    }
  });
};

module.exports = Router;
},{"../gen-vdl/v.io/v23/naming":49,"../gen-vdl/v.io/v23/security":53,"../gen-vdl/v.io/v23/verror":57,"../gen-vdl/v.io/x/ref/services/wspr/internal/lib":61,"../gen-vdl/v.io/x/ref/services/wspr/internal/principal":63,"../gen-vdl/v.io/x/ref/services/wspr/internal/rpc/server":64,"../lib/deferred":69,"../lib/hex-vom":71,"../lib/promise":73,"../naming/util":82,"../proxy/message-type":84,"../proxy/stream":87,"../proxy/stream-handler":86,"../runtime/shared-context-keys":105,"../security/blessings":114,"../security/create-security-call":118,"../vdl":133,"../vdl/byte-util":125,"../vdl/error-conversion":130,"../vdl/type-util":144,"../vdl/util":147,"../vom":165,"../vtrace":173,"./../lib/vlog":79,"./create-server-call":90,"./glob":92,"./glob-stream":91,"./stream-close-handler":99}],98:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var Deferred = require('./../lib/deferred');
var Promise = require('./../lib/promise');
var asyncCall = require('../lib/async-call');
var InspectableFunction = require('../lib/inspectable-function');
var vlog = require('./../lib/vlog');
var inspector = require('./../lib/arg-inspector');
var Invoker = require('./../invocation/invoker');
var defaultAuthorizer = require('../security/default-authorizer');
var actions = require('./../verror/actions');
var makeError = require('../verror/make-errors');
var ServerOption = require('./server-option');

var nextServerID = 1; // The ID for the next server.

/**
 * @summary
 * Server defines the interface for managing a collection of services.
 * @description
 * <p>Private Constructor, use
 * [Runtime#newServer]{@link module:vanadium~Runtime#newServer} or
 * [Runtime#newServerDispatchingServer]
 * {@link module:vanadium~Runtime#newServerDispatchingServer}
 * </p>
 * @inner
 * @constructor
 * @memberof module:vanadium.rpc
 */
function Server(router) {
  if (!(this instanceof Server)) {
    return new Server(router);
  }

  this._router = router;
  this._rootCtx = router._rootCtx;
  this._handle = 0;
  this.id = nextServerID++;
  this.dispatcher = null;
  this.serviceObjectHandles = {};
}

/**
 * Stop gracefully stops all services on this Server.
 * New calls are rejected, but any in-flight calls are allowed to complete.
 * All published named are unmounted.
 * @param {module:vanadium~voidCb} [cb] If provided, the function
 * will be called on completion.
 * @return {Promise<void>} Promise to be called when stop service completes or
 * fails
 */
Server.prototype.stop = function(cb) {
  return this._router.stopServer(this, cb);
};

/**
 * Adds the specified name to the mount table for the object or dispatcher
 * used to create this server.
 * @public
 * @param {string} name Name to publish.
 * @param {module:vanadium~voidCb} [cb] If provided, the function
 * will be called on completion.
 * @return {Promise<void>} Promise to be called when operation completes or
 * fails
 */
Server.prototype.addName = function(name, cb) {
  return this._router.addName(name, this, cb);
};

/**
 * Removes the specified name from the mount table.
 * @public
 * @param {string} name Name to remove.
 * @param {function} [cb] If provided, the function will be called on
 * completion. The only argument is an error if there was one.
 * @return {Promise<void>} Promise to be called when operation completes or
 * fails.
 */
Server.prototype.removeName = function(name, cb) {
  return this._router.removeName(name, this, cb);
};

/*
 * Initializes the JavaScript server by creating a server object on
 * the WSPR side.
 * @private
 */
Server.prototype._init = function(name, dispatcher,
  serverOption, cb) {

  this.serverOption = serverOption || new ServerOption();
  this.dispatcher = dispatcher;
  return this._router.newServer(name, this, cb);
};

/**
 * @private
 * @param {Number} handle The handle for the service.
 * @return {Object} The invoker corresponding to the provided error.
 */
Server.prototype._getInvokerForHandle = function(handle) {
  var result = this.serviceObjectHandles[handle];
  delete this.serviceObjectHandles[handle];

  return result.invoker;
};

/**
 * Handles the authorization for an RPC.
 * @private
 * @param {Number} handle The handle for the authorizer.
 * @param {module:vanadium.context.Context} ctx The ctx of the
 * call.
 * @param {module:vanadium.security~SecurityCall} call The security call.
 * @return {Promise} A promise that will be fulfilled with the result.
 */
Server.prototype._handleAuthorization = function(handle, ctx, call) {
  var handler = this.serviceObjectHandles[handle];
  var authorizer = defaultAuthorizer;
  if (handler && handler.authorizer) {
    authorizer = handler.authorizer;
  }

  var def = new Deferred();
  var inspectableAuthorizer = new InspectableFunction(authorizer);
  asyncCall(ctx, null, inspectableAuthorizer, [], [ctx, call],
    function(err) {
      if (err) {
        def.reject(err);
        return;
      }
      def.resolve();
    });
  return def.promise;
};

var InvokeOnNonInvoker = makeError(
  'v.io/core/javascript.InvokeOnNonInvoker', actions.NO_RETRY,
  '{1:}{2:} trying to invoke on a non-invoker{:_}');
/**
 * Handles the result of lookup and returns an error if there was any.
 * @private
 */
Server.prototype._handleLookupResult = function(object) {
  if (!object.hasOwnProperty('service')) {
    // TODO(bjornick): Use the correct context here.
    throw new InvokeOnNonInvoker(this._rootCtx);
  }
  object._handle = this._handle;
  try {
    object.invoker = new Invoker(object.service);
  } catch (e) {
    vlog.logger.error('lookup failed', e);
    return e;
  }
  this.serviceObjectHandles[object._handle] = object;
  this._handle++;
  return null;
};

/*
 * Perform the lookup call to the user code on the suffix and method passed in.
 * @private
 */
Server.prototype._handleLookup = function(suffix) {
  var self = this;
  var def = new Deferred();

  var argsNames = inspector(this.dispatcher).names;
  var useCallback = argsNames.length >= 2;
  var cb = function(err, val) {
    if (err) {
      def.reject(err);
    } else {
      def.resolve(val);
    }
  };

  var result;
  try {
    result = this.dispatcher(suffix, cb);
  } catch (e) {
    def.reject(e);
    vlog.logger.error(e);
    return def.promise;
  }

  if (!useCallback) {
    if (result === undefined) {
      return def.promise.then(handleResult);
    }

    if (result instanceof Error) {
      def.reject(result);
      return def.promise;
    }

    def.resolve(result);
  }

  function handleResult(v) {
    var err = self._handleLookupResult(v);
    if (err) {
      return Promise.reject(err);
    }
    return Promise.resolve(v);
  }

  return def.promise.then(handleResult);
};

/**
 * Export the module
 */
module.exports = Server;
},{"../lib/async-call":67,"../lib/inspectable-function":72,"../security/default-authorizer":119,"../verror/make-errors":152,"./../invocation/invoker":65,"./../lib/arg-inspector":66,"./../lib/deferred":69,"./../lib/promise":73,"./../lib/vlog":79,"./../verror/actions":148,"./server-option":96}],99:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var Incoming = require('../proxy/message-type').Incoming;
var vlog = require('../lib/vlog');

module.exports = StreamCloseHandler;

// Handles stream closes and cancel messages.
function StreamCloseHandler(ctx) {
  this.ctx = ctx;
}

StreamCloseHandler.prototype.handleResponse = function(type, data) {
  if (type === Incoming.CANCEL) {
    if (this.ctx && this.ctx.cancel) {
      return this.ctx.cancel();
    }
  }
  if (type !== Incoming.STREAM_CLOSE) {
    vlog.logger.error('Unexpected message ' + type);
    return false;
  }
  return true;
};

},{"../lib/vlog":79,"../proxy/message-type":84}],100:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var Catalog = require('../verror/catalog');
module.exports = new Catalog();

},{"../verror/catalog":149}],101:[function(require,module,exports){
(function (process){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

module.exports = normalize(detectLanguage());
function detectLanguage() {
  if (typeof this.navigator !== 'undefined') {
    return this.navigator.languages[0];
  }

  if (process.env.LANGUAGE) {
    return process.env.LANGUAGE.split(':')[0];
  }

  if (process.env.LC_ALL) {
    return process.env.LC_ALL.split('-')[0];
  }
  if (process.env.LANG) {
    return process.env.LANG.split('-')[0];
  }
  return 'en-US';
}

function normalize(l) {
  return l.replace('_', '-').split('.')[0];
}

}).call(this,require('_process'))
},{"_process":11}],102:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

module.exports = {};

},{}],103:[function(require,module,exports){
(function (process){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Vanadium Runtime
 * @private
 */
var EE = require('eventemitter2').EventEmitter2;
var isBrowser = require('is-browser');
var Deferred = require('../lib/deferred');
var inherits = require('inherits');
var Server = require('../rpc/server');
var ServerRouter = require('../rpc/server-router');
var GranterRouter = require('../rpc/granter-router');
var leafDispatcher = require('../rpc/leaf-dispatcher');
var Client = require('../rpc/client');
var Namespace = require('../naming/namespace');
var CaveatValidatorRegistry = require('../security/caveat-validator-registry');
var Principal = require('../security/principal');
var vlog = require('../lib/vlog');
var context = require('../context');
var SharedContextKeys = require('./shared-context-keys');
var vtrace = require('../vtrace');
var Controller =
  require('../gen-vdl/v.io/x/ref/services/wspr/internal/app').Controller;
var BlessingsCache = require('../security/blessings-cache');
var BlessingsRouter = require('../security/blessings-router');

module.exports = {
  init: init
};

/*
 * Initialize a Vanadium Runtime.
 * Runtime exposes entry points to create servers, client, blessing and other
 * Vanadium functionality.
 * @private
 */
function init(options, cb) {
  var rt = new Runtime(options);
  var promise = Promise.resolve(rt);

  if (isBrowser) {
    // In the browser, we must create the app instance in browspr.  We send
    // along the namespaceRoots and proxy, if they have been provided.  If they
    // are empty, the defaults from the extension options page will be used.
    var settings = {
      namespaceRoots: options.namespaceRoots || [],
      proxy: options.proxy || ''
    };

    promise = promise.then(function(rt) {
      var def = new Deferred();
      rt._getProxyConnection().createInstance(settings, function(err) {
        if (err) {
          return def.reject(err);
        }
        def.resolve(rt);
      });
      return def.promise;
    });
  }

  if (cb) {
    promise.then(function(rt) {
      cb(null, rt);
    }, function(err) {
      cb(err);
    });
  }
  return promise;
}

/**
 * Crash event.
 * <p>Emitted when the runtime crashes in an unexpected way. Recovery from
 * crash event requires restarting the application.<p>
 * @event module:vanadium~Runtime#crash
 */

/**
 * @summary
 * Runtime exposes entry points to create servers, client, namespace client and
 * other Vanadium functionality.
 * @Description
 * <p>This constructor should not be used directly, instead use
 * [vanadium.init]{@link module:vanadium.init}</p>
 *
 * <p>Runtime is also an EventEmitter and emits
 * [crash event]{@link module:vanadium~Runtime#event:crash} when it crashes in
 * an unexpected way.</p>
 *
 * @property {string} accountName The accountName that the user associated to
 * this runtime.
 * @property {module:vanadium.security~Principal} principal The principal
 * associated with this runtime.  All operations that come from this
 * runtime, including operations that come from
 * [Servers]{@link module:vanadium.rpc~Server} and
 * [Clients]{@link module:vanadium.rpc~Client}, will use this principal.
 * @property {module:vanadium.security~CaveatValidatorRegistry} caveatRegistry
 * Used to register custom first party caveat validators.
 * @inner
 * @memberof module:vanadium
 * @constructor
 */
function Runtime(options) {
  if (!(this instanceof Runtime)) {
    return new Runtime(options);
  }

  EE.call(this);

  this.accountName = options.accountName;
  this._wspr = options.wspr;
  this._client = new Client(this._getProxyConnection());
  this._controller = this._client.bindWithSignature(
    '__controller', [Controller.prototype._serviceDescription]);
  this.principal = new Principal(this.getContext(), this._controller);
  this._name = options.appName;
  this._language = options.language;
  this.caveatRegistry = new CaveatValidatorRegistry();
  this.blessingsCache = new BlessingsCache();
  this._blessingsRouter = new BlessingsRouter(this._getProxyConnection(),
    this.blessingsCache);
}

inherits(Runtime, EE);

/**
 * Closes the runtime, freeing all the related resources and stopping and
 * unpublishing all the servers created in the runtime.
 *
 * @param {function} [cb] Gets called once the runtime is closed.
 * @returns {Promise} Promise that will be resolved or rejected when runtime is
 * closed.
 */
Runtime.prototype.close = function(cb) {
  if (this._crashed) {
    // NaCl plugin crashed. Shutting down will not work.
    return process.nextTick(function() {
      cb(new Error('Runtime crashed, can not shutdown gracefully.'));
    });
  }

  var router = this._getRouter();
  var proxy = this._getProxyConnection();
  return router.cleanup().then(function() {
    return proxy.close(cb);
  });
};

/* jshint ignore:start */
/**
 * NewServerOptionalArgs is a set of options that are passed to the
 * [serve]{@link module:vanadium~Runtime#newServer}.
 * @typedef module:vanadium.rpc~Server~NewServerOptionalArgs
 * @property {module:vanadium.security.Authorize} authorizer An Authorizer
 * that will handle the authorization for the method call.  If null, then the
 * default strict authorizer will be used.
 * @property {module:vanadium.rpc~Server~ServerOption} serverOption Optional
 * server configuration such as whether the server is a mount table or
 * represents a leaf server. serverOption can be created with the
 * [vanadium.rpc.serverOption(opts)]{@link module:vanadium.rpc#serverOption}
 * method.
 */

/**
 * Callback passed into NewServer and NewDispatchingServer
 * @callback module:vanadium.rpc~Server~NewServer-callback
 * @param {Error} err An error if one occurred.
 * @param {module:vanadium.rpc~Server} server The server object.
 */

// TODO(aghassemi) the serviceObject example needs to point to a "Guides" page
// on the website when we have it. https://github.com/vanadium/issues/issues/444
/**
 * <p>Asynchronously creates a server and associates object with name by
 * publishing the address of the server with the mount table under the supplied
 * name and using authorizer to authorize access to it.</p>
 * <p>If name is an empty string, no attempt will made to publish that
 * name to a mount table.
 * To publish the same object under multiple names,
 * {@link module:vanadium.rpc~Server#addName|addName} can be used.</p>
 * <p>Simple usage:</p>
 * <pre>
 * rt.newServer('service/name', serviceObject, {
 *   authorizer: serviceAuthorizer
 * }, function(server) {
 *   // server is now active and listening for RPC calls.
 * });
 * </pre>
 * <p>
 * serviceObject is simply a JavaScript object that implements service methods.
 * </p>
 * <p>
 * <pre>
 * var serviceObject = new MyService();
 * function MyService() {}
 * </pre>
 * <p>
 * Each service method must take [ctx]{@link module:vanadium.context.Context}
 * and [serverCall]{@link module:vanadium.rpc~ServerCall} as the
 * first two parameters.
 * </p>
 * <p>
 * The output arguments can be given in several forms - through direct return,
 * return of a promise or calling a callback that is optionally the
 * last parameter.
 * </p>
 * <pre>
 * // Sync method that echoes the input text immediately.
 * MyService.prototype.echo = function(ctx, serverCall, text) {
 *   return 'Echo: ' + text;
 * };
 * </pre>
 * <pre>
 * // Async method that echoes the input text after 1 second, using Promises.
 * MyService.prototype.delayedEcho = function(ctx, serverCall, text) {
 *   return new Promise(function(resolve, reject) {
 *     setTimeout(function() {
 *       resolve('Echo: ' + text);
 *     }, 1000);
 *   });
 * };
 *</pre>
 *<pre>
 * // Async method that echoes the input text after 1 second, using Callbacks.
 * MyService.prototype.delayedEcho = function(ctx, serverCall, text, callback) {
 *   setTimeout(function() {
 *     // first argument to the callback is error, second argument is results
 *     callback(null, 'Echo: ' + text);
 *   }, 1000);
 * };
 *</pre>
 *
 * @public
 * @param {string} name Name to publish under.
 * @param {object} serviceObject The service object that has a set of
 * exported methods.
 * @param {module:vanadium.rpc~Server~NewServerOptionalArgs} [optionalArgs]
 * Optional arguments for newServer such as 'authorizer' or 'serverOptions'.
 * @param {module:vanadium.rpc~Server~NewServer-callback} [cb] If provided,
 * the function will be called when server is ready and listening for RPC calls.
 * @return {Promise<module:vanadium.rpc~Server>} Promise to be called when
 * server is ready and listening for RPC calls.
 */
/* jshint ignore:end */
Runtime.prototype.newServer = function(name, serviceObject, optionalArgs, cb) {
  if (typeof optionalArgs === 'function') {
    cb = optionalArgs;
    optionalArgs = undefined;
  }
  optionalArgs = optionalArgs || {};
  var dispatcher = leafDispatcher(serviceObject, optionalArgs.authorizer);
  return this.newDispatchingServer(name, dispatcher,
    optionalArgs.serverOption, cb);
};

/**
 * @typedef module:vanadium.rpc~Server~ServerDispatcherResponse
 * @type {object}
 * @property {object} service The Invoker that will handle
 * method call.
 * @property {module:vanadium.security.Authorize} authorizer An Authorizer that
 * will handle the authorization for the method call.  If null, then the default
 * authorizer will be used.
 */

/**
 * A function that returns the service implementation for the object identified
 * by the given suffix.
 * @callback module:vanadium.rpc~Server~ServerDispatcher
 * @param {string} suffix The suffix for the call.
 * @param {module:vanadium.rpc~Server~ServerDispatcher-callback} cb
 * The callback to call when the dispatch is complete.
 * @return {Promise<module:vanadium.rpc~Server~ServerDispatcherResponse>}
 * Either the DispatcherResponse object to
 * handle the method call or a Promise that will be resolved the service
 * callback.
 */

/**
 * Callback passed into Dispatcher.
 * @callback module:vanadium.rpc~Server~ServerDispatcher-callback
 * @param {Error} err An error if one occurred.
 * @param {object} object The object that will handle the method call.
 */

/**
 * <p>Asynchronously creates a server and associates dispatcher with the
 * portion of the mount table's name space for which name is a prefix, by
 * publishing the address of this dispatcher with the mount table under the
 * supplied name.
 * RPCs invoked on the supplied name will be delivered to the supplied
 * Dispatcher's lookup method which will in turn return the object. </p>
 * <p>Simple usage:</p>
 * <pre>
 * rt.newDispatchingServer('service/name', dispatcher, function(server) {
 *   // server is now active and listening for RPC calls.
 * });
 * </pre>
 *
 * <p>If name is an empty string, no attempt will made to publish that
 * name to a mount table.
 * To publish the same object under multiple names,
 * {@link module:vanadium.rpc~Server#addName|addName} can be used.</p>
 *
 * @public
 * @param {string} name Name to publish under.
 * @param {module:vanadium.rpc~Server~ServerDispatcher} dispatcher A function
 * that will take in the suffix and the method to be called and return the
 * service object for that suffix.
 * @property {module:vanadium.rpc~Server~ServerOption} [serverOption] Optional
 * server configuration such as whether the server is a mount table or
 * represents a leaf server. serverOption can be created with the
 * [vanadium.rpc.serverOption(opts)]{@link module:vanadium.rpc#serverOption}
 * method.
 * @param {module:vanadium.rpc~Server~NewServer-callback} [cb] If provided,
 * the function will be called when server is ready and listening for RPC calls.
 * @return {Promise<module:vanadium.rpc~Server>} Promise to be called when
 * server is ready and listening for RPC calls.
 */
Runtime.prototype.newDispatchingServer = function(name, dispatcher,
  serverOption, cb) {

  if (typeof serverOption === 'function') {
    cb = serverOption;
    serverOption = undefined;
  }

  var def = new Deferred(cb);
  var server = new Server(this._getRouter());

  server._init(name, dispatcher, serverOption).then(function() {
    def.resolve(server);
  }).catch(def.reject);

  return def.promise;
};

/**
 * Returns a [Client]{@link module:vanadium.rpc~Client} instance.<br>
 * Client allows one to bind to Vanadium names and call methods on them.
 * @return {module:vanadium.rpc~Client} A Client instance.
 */
Runtime.prototype.getClient = function() {
  return this._client;
};

/**
 * Returns the root runtime [context]{@link module:vanadium.context.Context}<br>
 * Context objects provide a number of features such as
 * ability to provide configuration for requests such as timeout durations,
 * tracing across requests for debugging, etc...<br>
 * In order to provide these facilities context objects are required as the
 * first parameter for client calls and also for requests that are incoming
 * to servers.
 * @return {module:vanadium.context.Context} The root runtime context.
 */
Runtime.prototype.getContext = function() {
  if (this._rootCtx) {
    return this._rootCtx;
  }
  var ctx = new context.Context();
  ctx = ctx.withValue(SharedContextKeys.COMPONENT_NAME, this._name);
  if (this._language) {
    ctx = ctx.withValue(SharedContextKeys.LANG_KEY, this._language);
  }
  ctx = ctx.withValue(SharedContextKeys.RUNTIME, this);
  ctx = vtrace.withNewStore(ctx);
  ctx = vtrace.withNewTrace(ctx);
  this._rootCtx = ctx;
  return ctx;
};

/**
 * <p>Returns a [namespace]{@link module:vanadium.naming~Namespace} client.</p>
 * <p>Namespace client enables interactions with the Vanadium namespace such as
 * globbing, mounting, setting permissions and other name related operations.
 * </p>
 * @return {module:vanadium.naming~Namespace} A namespace client instance.
 */
Runtime.prototype.getNamespace = function() {
  this._ns = this._ns || new Namespace(this.getClient(),
    this.getContext());
  return this._ns;
};

/**
 * Get or creates a new proxy connection
 * @return {ProxyConnection} A proxy connection
 * @private
 */
Runtime.prototype._getProxyConnection = function() {
  if (this._proxyConnection) {
    return this._proxyConnection;
  }

  var ProxyConnection;
  if (this._wspr) {
    vlog.logger.info('Using WSPR at: %s', this._wspr);
    ProxyConnection = require('../proxy/websocket');
    this._proxyConnection = new ProxyConnection(this._wspr);
  } else {
    vlog.logger.info('Using the Vanadium Extension\'s NaCl WSPR');
    ProxyConnection = require('../proxy/nacl');
    this._proxyConnection = new ProxyConnection();
  }

  // relay crash event from proxy
  var self = this;
  this._proxyConnection.on('crash', function(e) {
    self._crashed = true;
    self.emit('crash', e);
  });

  return this._proxyConnection;
};

/**
 * Get or creates a router
 * @return {ServerRouter} A router
 * @private
 */
Runtime.prototype._getRouter = function() {
  if (!this._router) {
    this._router = new ServerRouter(
      this._getProxyConnection(),
      this._name,
      this.getContext(),
      this._controller,
      this.caveatRegistry,
      this.blessingsCache);
  }
  return this._router;
};

/**
 * Get or creates a granter router
 * @return {GranterRouter} A granter router
 * @private
 */
Runtime.prototype._getGranterRouter = function() {
  if (!this._granterRouter) {
    this._granterRouter = new GranterRouter(
      this._getProxyConnection(),
      this.getContext(),
      this.blessingsCache);
  }
  return this._granterRouter;
};
}).call(this,require('_process'))
},{"../context":48,"../gen-vdl/v.io/x/ref/services/wspr/internal/app":60,"../lib/deferred":69,"../lib/vlog":79,"../naming/namespace":81,"../proxy/nacl":85,"../proxy/websocket":88,"../rpc/client":89,"../rpc/granter-router":93,"../rpc/leaf-dispatcher":95,"../rpc/server":98,"../rpc/server-router":97,"../security/blessings-cache":111,"../security/blessings-router":112,"../security/caveat-validator-registry":116,"../security/principal":121,"../vtrace":173,"./shared-context-keys":105,"_process":11,"eventemitter2":30,"inherits":32,"is-browser":33}],104:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var SharedContextKeys = require('./shared-context-keys');

module.exports = runtimeForContext;
/**
 * Gets the [Runtime]{@link module:vanadium~Runtime} for a given
 * [Context]{@link module:vanadium.context.Context}
 * @param {module:vanadium.context.Context} ctx The context
 * @return {module:vanadium~Runtime} the runtime for the context
 * @memberof module:vanadium
 */
function runtimeForContext(ctx) {
  return ctx.value(SharedContextKeys.RUNTIME);
}


},{"./shared-context-keys":105}],105:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var ContextKey = require('../context/context-key');
/**
 * Key for name of the component
 * @private
 */
module.exports.COMPONENT_NAME = new ContextKey();

/**
 * Key for the language id
 * @private
 */
module.exports.LANG_KEY = new ContextKey();

/**
 * Key for the op
 * @private
 */
module.exports.OP = new ContextKey();

module.exports.RUNTIME = new ContextKey();

},{"../context/context-key":47}],106:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/*
 * Extends the vdl generated AccessList by adding additional methods.
 * @fileoverview
 */

var blessingMatches = require('./blessing-matching');
var AccessList = require('../../gen-vdl/v.io/v23/security/access').AccessList;

/**
 * Returns true iff the AccessList grants access to a principal that
 * presents blessings.
 * (i.e., if at least one of the blessings matches the AccessList).
 * @param {string[]} blessings Presented blessing names.
 * @return {boolean}
 * @name includes
 * @method
 * @memberof module:vanadium.security.access.AccessList.prototype
 */
 AccessList.prototype.includes = function(blessings) {
  var accessList = this;

  // Remove the blessing that are blacklisted.
  var unblacklistedNames = blessings.filter(function(blessing) {
    return accessList.notIn.every(function(pattern) {
      return !blessingMatches(blessing, pattern);
    });
  });
  // Check the remaining blessing for a match in the white list.
  return unblacklistedNames.some(function(blessing) {
    return accessList.in.some(function(pattern) {
      return blessingMatches(blessing, pattern);
    });
  });
 };
},{"../../gen-vdl/v.io/v23/security/access":52,"./blessing-matching":108}],107:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
/**
 * @fileoverview The Allow Everyone authorizer
 * @private
 */

module.exports = authorizer;

/**
 * @function
 * @name allowEveryoneAuthorizer
 * @summary The allowEveryoneAuthorizer is an authorizer that allows access to
 * every user, regardless of their blessings.
 * @description WARNING: This authorizer provides NO security whatsoever. It
 * should be used only in tests or during development, or in applications that
 * do not require any authorization.
 * @memberof module:vanadium.security.access
 * @return {module:vanadium.security.Authorize} An authorizer which allows
 * everybody.
 */
function authorizer() {
  return function authorize(ctx, call) {
    return;
  };
}

},{}],108:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview blessing pattern matcher
 * @private
 */

var vdlSecurity = require('../../gen-vdl/v.io/v23/security');
module.exports = blessingMatches;

// A blessing matches a pattern iff one of the following holds:
// - the pattern is '...' which is matched by all blessings.
// - the pattern ends in ':$' and the blessing is the same as the
//   pattern string with the ':$' stripped out.
// - the pattern does not end in ':$' and the blessing is an extension
//   of the pattern.
function blessingMatches(blessing, pattern) {
  // TODO(ataly, ashankar): Do we need to check that the pattern is valid?
  if (pattern === vdlSecurity.AllPrincipals.val) {
    return true;
  }
  var blessingParts = blessing.split(vdlSecurity.ChainSeparator);
  var patternParts = pattern.split(vdlSecurity.ChainSeparator);

  for (var i = 0; i < patternParts.length; i++) {
    // If there is a '$' at the end of the pattern then
    // we have a match if there are no more blessingParts
    // left
    if (patternParts[i] === vdlSecurity.NoExtension.val) {
      return i === patternParts.length-1 && i === blessingParts.length;
    }

    if ((i >= blessingParts.length) || (blessingParts[i] !== patternParts[i])) {
      return false;
    }
  }
  return true;
}

},{"../../gen-vdl/v.io/v23/security":53}],109:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Require the extensions files.
require('./accesslist-extensions');

var extend = require('xtend');
/* jshint ignore:start */
/**
 * @summary Package access defines types and services for dynamic access
 * control in Vanadium.  Examples: "allow app to read this photo", "
 * prevent user from modifying this file".
 *
 * @description
 * <p>Package access defines types and services for dynamic access
 * control in Vanadium.  Examples: "allow app to read this photo", "
 * prevent user from modifying this file".</p>
 *
 * <h2>Target Developers</h2>
 *
 * <p>Developers creating functionality to share data or services between
 * multiple users/devices/apps.</p>
 *
 * <h2>Overview</h2>
 *
 * <p>Vanadium objects provide GetPermissions and SetPermissions methods.  A
 * [Permissions]{@link module:vanadium.security.access.Permissions} object
 * contains the set of blessings that grant principals access to the object.
 * All methods on objects can have "tags" on them and the access list used for
 * the method is selected based on that tag.</p>
 *
 * <p>An object can have multiple names, so GetPermissions and SetPermissions
 * can be invoked on any of these names, but the object itself has a single
 * Permissions.</p>
 *
 * <p>SetPermissions completely replaces the Permissions. To perform an atomic
 * read-modify-write of the Permissions, use the version parameter.</p>
 *
 * <h2>Conventions</h2>
 *
 * <p>Service implementors should follow the conventions below to be consistent
 * with other parts of Vanadium and with each other.</p>
 *
 * <p>All methods that create an object (e.g. Put, Mount, Link) should take an
 * optional Permissions parameter.  If the Permissions is not specified, the new
 * object, O, copies its Permissions from the parent.  Subsequent changes to the
 * parent Permissions are not automatically propagated to O.  Instead, a client
 * library must make recursive Permissions changes.</p>
 *
 * <p>Resolve access is required on all components of a name, except the last
 * one, in order to access the object referenced by that name.  For example,
 * for principal P to access the name "a/b/c", P must have resolve access to
 * "a" and "a/b". </p>
 *
 * <p>The Resolve tag means that a principal can traverse that component of the
 * name to access the child.  It does not give the principal permission to list
 * the children via Glob or a similar method.  For example, a server might have
 * an object named "home" with a child for each user of the system.  If these
 * users were allowed to list the contents of "home", they could discover the
 * other users of the system.  That could be a privacy violation.  Without
 * Resolve, every user of the system would need read access to "home" to access
 * "home/<user>".  If the user called Glob("home/*"), it would then be up to
 * the server to filter out the names that the user could not access.  That
 * could be a very expensive operation if there were a lot of children of
 * "home".  Resolve protects these servers against potential denial of service
 * attacks on these large, shared directories.</p>
 *
 * <p>Blessings allow for sweeping access changes. In particular, a blessing is
 * useful for controlling access to objects that are always accessed together.
 * For example, a document may have embedded images and comments, each with a
 * unique name. When accessing a document, the server would generate a blessing
 * that the client would use to fetch the images and comments; the images and
 * comments would have this blessed identity in their AccessLists. Changes to
 * the document's AccessLists are therefore "propagated" to the images and
 * comments.</p>
 *
 * <p>In the future, we may add some sort of "groups" mechanism to provide an
 * alternative way to express access control policies.</p>
 *
 * <p>Some services will want a concept of implicit access control.  They are free
 * to implement this as is best for their service.  However, GetPermissions should
 * respond with the correct Permissions.  For example, a corporate file server would
 * allow all employees to create their own directory and have full control
 * within that directory.  Employees should not be allowed to modify other
 * employee directories.  In other words, within the directory "home", employee
 * E should be allowed to modify only "home/E".  The file server doesn't know
 * the list of all employees a priori, so it uses an implementation-specific
 * rule to map employee identities to their home directory.</p>
 * @namespace
 * @name access
 * @memberof module:vanadium.security
 */
/* jshint ignore:end */
module.exports = extend(require('../../gen-vdl/v.io/v23/security/access'), {
  allowEveryoneAuthorizer: require('./allow-everyone-authorizer'),
  permissionsAuthorizer: require('./permissions-authorizer')
});

},{"../../gen-vdl/v.io/v23/security/access":52,"./accesslist-extensions":106,"./allow-everyone-authorizer":107,"./permissions-authorizer":110,"xtend":41}],110:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
/**
 * @fileoverview The Permissions authorizer
 * @private
 */
var unwrap = require('../../vdl/type-util').unwrap;
var makeError = require('../../verror/make-errors');
var actions = require('../../verror/actions');
var vdlAccess = require('../../gen-vdl/v.io/v23/security/access');
var NoPermissionsError = vdlAccess.NoPermissionsError;
var Permissions = vdlAccess.Permissions;

module.exports = permissionsAuthorizer;
var pkgPath = 'v.io/v23/security/access';
var MultipleTagsError = makeError(
  pkgPath + '.errMultipleMethodTags',
  actions.NO_RETRY,
  '{1:}{2:}PermissionsAuthorizer on {3}.{4} cannot handle multiple tags of ' +
  'type {5} ({6}); this is likely unintentional{:_}');
var NoTagsError = makeError(
  pkgPath + '.errNoMethodTags',
  actions.NO_RETRY,
  '{1:}{2:}PermissionsAuthorizer.Authorize called with an object ({3}, ' +
  'method {4}) that has no tags of type {5}; this is likely unintentional' +
  '{:_}');

/**
 * The Permissions authorizer.
 * @function
 * @memberof module:vanadium.security.access
 * @name permissionsAuthorizer
 * @param {module:vanadium.security.access.Permissions} perms The set of
 * permission to apply.
 * @param {function} type The type constructor function of tags that this
 * authorizer understands.
 * @return {module:vanadium.security.Authorize} An authorizer that applies
 * the perms.
 */
function permissionsAuthorizer(perms, type) {
  // Force the Permissions to have the correct Permissions format.
  var permissions = unwrap(new Permissions(perms));

  return function authorize(ctx, call) {
    // If the remoteBlessings has a public key, and it refers to ourselves
    // (i.e a self rpc), then we always authorize.
    if (call.remoteBlessings.publicKey &&
        call.localBlessings.publicKey === call.remoteBlessings.publicKey) {
      return;
    }
    var tags = call.methodTags.filter(function(t) {
      return t instanceof type;
    });
    if (tags.length > 1) {
      throw new MultipleTagsError(ctx, call.suffix, call.method, type._type,
                                   call.methodTags);
    }

    if (tags.length === 0) {
      throw new NoTagsError(ctx, call.suffix, call.method, type._type,
                             call.methodTags);

    }

    var key = unwrap(tags[0]);
    var lists = permissions.get(key);
    if (!lists || !lists.includes(call.remoteBlessingStrings)) {
      throw new NoPermissionsError(ctx, call.remoteBlessingStrings, [], key);
    }
    return;
  };
}

},{"../../gen-vdl/v.io/v23/security/access":52,"../../vdl/type-util":144,"../../verror/actions":148,"../../verror/make-errors":152}],111:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var unwrap = require('../vdl/type-util').unwrap;
var vlog = require('../lib/vlog');
var Deferred = require('../lib/deferred');

/**
 * @fileoverview A cache of blessings, used in conjunction with the cache
 * in WSPR (principal/cache.go) to reduce the number of times blessings must
 * be sent across the wire.
 * This is kept in sync with the WSPR cache.
 * @private
 */

module.exports = BlessingsCache;

/**
 * @summary Cache of blessings received from WSPR.
 * @description This cache is kept in sync with WSPR to reduce the
 * number of times that blessings must be sent across the wire.
 * @constructor
 * @private
 */
function BlessingsCache() {
 // Each entry has the following fields (which may or may not exist):
 // - deferredBlessings: a deferred object whose promise resolves to the
 // blessings
 // - refCount: number of references to the blessings
 // - deleteAfter: delete the entry after this number of blessings
 this._entries = {};
}

/**
 * @summary addBlessings adds blessings to the blessings cache.
 * @param {wspr.internal.principal.BlessingsCacheAddMessage} addMessage
 */
BlessingsCache.prototype.addBlessings = function(addMessage) {
  var id = this._unwrappedId(addMessage.cacheId);
  var entry = this._getOrCreateEntry(id);
  entry.deferredBlessings.resolve(addMessage.blessings);
};

/**
 * @summary deleteBlessings removes blessings from the blessings cache.
 * @param {wspr.internal.principal.BlessingsCacheAddMessage} addMessage
 */
BlessingsCache.prototype.deleteBlessings = function(deleteMessage) {
  var id = this._unwrappedId(deleteMessage.cacheId);
  var entry = this._getOrCreateEntry(id);
  entry.deleteAfter = deleteMessage.deleteAfter;

  this._deleteIfNoLongerNeeded(id);
};

/**
 * @summary blessingsFromId looks up a blessing by id or waits for it if it
 * has not been put in the cache yet
 * @param {wspr.internal.principal.BlessingsId} blessingsId
 */
BlessingsCache.prototype.blessingsFromId = function(blessingsId) {
  var id = unwrap(blessingsId);

  if (typeof id !== 'number') {
    throw new Error('Expected numeric blessings id');
  }
  if (id === 0) {
    // Zero is not a valid id.
    // TODO(bprosnitz) Replace this with null once we switch to full blessings
    // objects. It is currently a number because there are no optional numbers
    // now in VDL.
    return Promise.resolve(null);
  }

  var entry = this._getOrCreateEntry(id);
  var cache = this;
  return entry.deferredBlessings.promise.then(function(blessings) {
    cache._increaseRefCount(id);
    cache._deleteIfNoLongerNeeded(id);
    return blessings;
  });
};

BlessingsCache.prototype._increaseRefCount = function(cacheId) {
  var entry = this._entries[cacheId];
  if (!entry) {
    throw new Error('Unexpectedly got id of missing entry');
  }
  entry.refCount++;
};

BlessingsCache.prototype._deleteIfNoLongerNeeded = function(cacheId) {
  var entry = this._entries[cacheId];
  if (!entry) {
    throw new Error('Entry unexpectedly not present');
  }

  if (entry.refCount >= entry.deleteAfter) {
    if (entry.refCount > entry.deleteAfter) {
      vlog.logger.warn('Got more references than expected');
    }
    if (entry.waiting) {
      vlog.logger.warn(
        'There should not be anything waiting on entry to be deleted');
    }
    delete this._entries[cacheId];
  }
};

BlessingsCache.prototype._getOrCreateEntry = function(cacheId) {
  if (!this._entries[cacheId]) {
    this._entries[cacheId] = {
      refCount: 0,
      deferredBlessings: new Deferred()
    };
  }
  return this._entries[cacheId];
};

BlessingsCache.prototype._unwrappedId = function(cacheId) {
  var id = unwrap(cacheId);
  if (typeof id !== 'number') {
    throw new Error('Got non-numeric id');
  }
  if (id <= 0) {
    throw new Error('Unexpected non-positive id ' + id);
  }
  return id;
};

},{"../lib/deferred":69,"../lib/vlog":79,"../vdl/type-util":144}],112:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoveriew A router that handles incoming requests to update the state
 * of the blessings cache.
 * @private
 */

var vlog = require('./../lib/vlog');
var Incoming = require('../proxy/message-type').Incoming;

module.exports = BlessingsRouter;

/**
 * A router that handles incoming requests to update the state of the blessings
 * cache.
 * @constructor
 * @private
 */
function BlessingsRouter(proxy, blessingsCache) {
  this._blessingsCache = blessingsCache;

  proxy.addIncomingHandler(Incoming.BLESSINGS_CACHE_MESSAGE, this);
}

BlessingsRouter.prototype.handleRequest = function(messageId, type, request) {
  switch (type) {
  case Incoming.BLESSINGS_CACHE_MESSAGE:
    this.handleBlessingsCacheMessages(request);
    return;
  default:
    vlog.logger.error('Unknown request type given to blessings router ' + type);
  }
};

BlessingsRouter.prototype.handleBlessingsCacheMessages = function(messages) {
  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];
    if (message.hasOwnProperty('add')) {
      this._blessingsCache.addBlessings(message.add);
    } else if (message.hasOwnProperty('delete')) {
      this._blessingsCache.deleteBlessings(message.delete);
    } else {
      vlog.logger.error('Unknown blessings cache message: ', message);
    }
  }
};

},{"../proxy/message-type":84,"./../lib/vlog":79}],113:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var Blessings = require('../../src/security/blessings');
var makeError = require('../../src/verror/make-errors');
var actions = require('../../src/verror/actions');

var InvalidUnionError = makeError('v.io/v23/security.errInvalidUnion',
  actions.NO_RETRY, {
    'en':
     '{1:}{2:} cannot create union of blessings bound to different public keys',
  }, []);


/**
 * @fileoverview Blessings related utilities that don't belong on the
 * Blessings object.
 * @private
 */

module.exports = {
  unionOfBlessings: unionOfBlessings
};

/**
 * A callback that is called with either an error or a
 * [Blessings]{@link module:vanadium.security~Blessings} object.
 * @callback module:vanadium.security~blessingsCb
 * @param {Error} err If set, the error that occured.
 * @param {module:vanadium.security~Blessings} blessings The blessings result.
 */

/**
* unionOfBlessings returns a Blessings object that carries the union of the
* provided blessings.
* @param {module:vanadium.context.Context} ctx The context.
* @param {...string} blessingsList The blessings to join
* @return {module:vanadium.security~Blessings} A blessing object consisting
* of the union of the input.
* @memberof module:vanadium.security
*/
function unionOfBlessings(ctx /*, blessingsA, blessingsB, ...*/) {
  var blessingsList = Array.prototype.slice.call(arguments, 1);

  blessingsList = blessingsList.filter(function(blessings) {
    return !!blessings;
  });

  switch(blessingsList.length) {
    case 0:
      return null;
    case 1:
      return blessingsList[0];
  }

  var firstKey = blessingsList[0].publicKey;
  var chains = [];
  for (var i = 0; i < blessingsList.length; i++) {
    var blessings = blessingsList[i];
    if (JSON.stringify(blessings.publicKey) !== JSON.stringify(firstKey)) {
      throw new InvalidUnionError();
    }
    chains = chains.concat(blessings.chains);
  }

  // Sort for prettier and more consistent output.
  chains = chains.sort(chainSorter);

  return new Blessings({
    publicKey: firstKey,
    certificateChains: chains
  });
}

// Provide some stability by sorting the chain list.
// The chains are first ordered by length, followed by the the result
// of comparing the first differing extension.
function chainSorter(a, b) {
  if (a.length !== b.length) {
    return a.length > b.length;
  }

  for (var i = 0; i < a.length; i++) {
    var aext = a[i].extension;
    var bext = b[i].extension;
    if (aext !== bext) {
      return aext > bext;
    }
  }

  return false;
}

},{"../../src/security/blessings":114,"../../src/verror/actions":148,"../../src/verror/make-errors":152}],114:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Blessings stub of vanadium identities
 * @private
 */

var unwrap = require('../vdl/type-util').unwrap;
var nativeTypeRegistry = require('../vdl/native-type-registry');
var vdlSecurity = require('../gen-vdl/v.io/v23/security');

module.exports = Blessings;

var wireBlessingsType = vdlSecurity.WireBlessings.prototype._type;
nativeTypeRegistry.registerFromNativeValue(Blessings, toWireBlessings,
  wireBlessingsType);
nativeTypeRegistry.registerFromWireValue(wireBlessingsType, fromWireBlessings);

/**
 * @summary Blessings encapsulates all cryptographic operations
 * required to prove that a set of (human-readable) blessing names are
 * bound to a principal in a specific call.
 * @description <p> Blessings encapsulates all cryptographic operations
 * required to prove that a set of (human-readable) blessing names are
 * bound to a principal in a specific call.</p>
 * <p>Blessings objects are meant to be presented to other principals to
 * authenticate and authorize actions.</p>
 * @property {module:vanadium.security.Certificate[]} chains Certificate chains.
 * @property {module:vanadium.security.PublicKey} publicKey The public key.
 * @constructor
 * @memberof module:vanadium.security
 * @inner
 */
function Blessings(wireblessings) {
  var unwrappedWireBlessings = unwrap(wireblessings);
  this.chains = unwrappedWireBlessings.certificateChains;
  if (this.chains.length === 0) {
    throw new Error('Refusing to create empty blessings object');
  }
  if (this.chains[0].length === 0) {
    throw new Error('First chain should be non-null');
  }
  this.publicKey = this.chains[0][this.chains[0].length - 1].publicKey;
}

/**
 * Get a string that describes this blessings object.
 * @return {string} A string describing the blessings.
 * @private
 */
Blessings.prototype.toString = function() {
  var parts = [];
  for (var chainidx = 0; chainidx < this.chains.length; chainidx++) {
    var chainParts = [];
    var chain = this.chains[chainidx];
    for (var certidx = 0; certidx < chain.length; certidx++) {
      var cert = chain[certidx];
      chainParts.push(cert.extension);
    }
    parts.push(chainParts.join(vdlSecurity.ChainSeparator));
  }
  return parts.join(' ');
};

function toWireBlessings(blessings) {
  if (!blessings) {
    // null is used for zero blessings
    return new vdlSecurity.WireBlessings({
      certificateChains: []
    });
  }

  if (typeof blessings !== 'object') {
    throw new Error('Expected blessings to be an object');
  }

  if (blessings.hasOwnProperty('certificateChains')) {
    // Assume this is a WireBlessings object. It isn't possible to directly
    // construct WireBlessings due to the way that native types are set up so
    // this check is used in place of instance of.
    // TODO(bprosnitz) Fix the way that native type conversion works.
    return blessings;
  }

  return new vdlSecurity.WireBlessings({
    certificateChains: blessings.chains
  });
}

function fromWireBlessings(wireblessings) {
  if (typeof wireblessings !== 'object') {
    throw new Error('Expected wire blessings to be an object');
  }

  if (wireblessings instanceof Blessings) {
    return wireblessings;
  }

  if (wireblessings.certificateChains.length === 0) {
    return null;
  }

  return new Blessings(wireblessings);
}

},{"../gen-vdl/v.io/v23/security":53,"../vdl/native-type-registry":137,"../vdl/type-util":144}],115:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Blessing store stub for vanadium blessing stores
 * @private
 */

 var Deferred = require('../lib/deferred');
 var runtimeFromContext = require('../../src/runtime/runtime-from-context');
 var verror = require('../gen-vdl/v.io/v23/verror');

 module.exports = BlessingStore;

/**
  * A callback that is called with either an error or a
  * [Blessings]{@link module:vanadium.security~Blessings} object.
  * @callback module:vanadium.security.BlessingStore~blessingsCb
  * @param {Error} err If set, the error that occured.
  * @param {module:vanadium.security~Blessings} blessings The blessings result.
  */
/**
  * A callback that is called with either an error or a
  * map from [BlessingsPattern]{@link module:vanadium.security~BlessingsPattern}
  * to [Blessings]{@link module:vanadium.security~Blessings}.
  * @callback module:vanadium.security.BlessingStore~peerBlessingsCb
  * @param {Error} err If set, the error that occured.
  * @param {Map<module:vanadium.security~BlessingsPattern,
  * module:vanadium.security~Blessings>} peerBlessings The peer blessings.
  */
/**
  * A callback that is called with either an error or a
  * [string] object.
  * @callback module:vanadium.security.BlessingStore~stringCb
  * @param {Error} err If set, the error that occured.
  * @param {string} str The string result.
  */
/**
  * A callback that has an error argument that may be falsy.
  * @callback module:vanadium.security.BlessingStore~onlyErrCb
  * @param {Error} err If set, the error that occured.
  */
 /**
  * @summary BlessingStore is a mapping between remote blessing string and
  * local blessing.
  * @description BlessingStore is the interface for storing blessings bound to
  * a principal and managing the subset of blessings to be presented to
  * particular peers.
  * This constructor should not be called directly. The BlessingStore can be
  * obtained from the principal object.
  * @constructor
  * @inner
  * @memberof module:vanadium.security
  */
 function BlessingStore(controller) {
   this._controller = controller;
 }

 /**
  * Sets an entry in the blessing store.
  * @param {module:vanadium.context.Context} ctx The context.
  * @param {module:vanadium.security~Blessings} blessings The blessings object.
  * @param {string} pattern The blessing match pattern.
  * @param {module:vanadium.security.BlessingStore~blessingsCb} cb An optional
  * callback that will return the blessing.
  * @return {Promise<module:vanadium.security~Blessings>} A promise that will
  * be resolved with the blessing.
  */
 BlessingStore.prototype.set = function(
   ctx, blessings, pattern, cb) {
   var def = new Deferred(cb);
   if (blessings === undefined) {
     def.reject(new verror.BadArgError(ctx,
       'Blessings handle not specified'));
     return def.promise;
   }
   if (pattern === undefined) {
     def.reject(new verror.BadArgError(ctx,
       'Pattern not specified'));
     return def.promise;
   }

   return this._controller.blessingStoreSet(ctx, blessings, pattern, cb);
 };

 /**
  * forPeer gets the set of blessings that have been previously
  * added to the store with an intent of being shared with peers
  * that have at least one of the provided blessings.
  * @param {module:vanadium.context.Context} ctx The context.
  * @param {...string} blessingNames The names of the blessings.
  * @param {module:vanadium.security.BlessingStore~blessingsCb} cb An optional
  * callback that will return the blessing.
  * @return {Promise<module:vanadium.security~Blessings>} A promise that will
  * be resolved with the blessing.
  */
 BlessingStore.prototype.forPeer = function(
   ctx/*, blessingName1, blessingName2, ..., cb */) {

   var args = Array.prototype.slice.call(arguments);
   args.shift(); // remove ctx

   var cb;
   if (args.length > 0 && typeof args[args.length - 1] === 'function') {
     cb = args.pop();
   }

   var blessingNames = args;
   return this._controller.blessingStoreForPeer(ctx, blessingNames, cb);
 };

 /**
  * setDefault sets up the Blessings made available on a subsequent call
  * to getDefault.
  * <br>
  * It is an error to call setDefault with a blessings whose public key
  * does not match the PublicKey of the principal for which this store
  * hosts blessings.
  * @param {module:vanadium.context.Context} ctx The context.
  * @param {module:vanadium.security~Blessings} blessings The blessings object.
  * @param {module:vanadium~voidCb} cb An optional callback that has no output
  * value.
  * @return {Promise} A promise that will be resolved without an output
  * value.
  */
 BlessingStore.prototype.setDefault = function(ctx, blessings, cb) {
   if (blessings === undefined) {
     var def = new Deferred(cb);
     def.reject(new verror.BadArgError(ctx,
       'Blessings handle not specified'));
     return def.promise;
   }

   return this._controller.blessingStoreSetDefault(ctx, blessings, cb);
 };

 /**
  * getDefault returns the blessings to be shared with peers for which
  * no other information is available in order to select blessings
  * from the store.
  * <br>
  * For example, getDefault can be used by servers to identify themselves
  * to clients before the client has identified itself.
  * @param {module:vanadium.context.Context} ctx The context.
  * @param {module:vanadium.security.BlessingStore~blessingsCb} cb An optional
  * callback that will return the blessing.
  * @return {Promise<module:vanadium.security~Blessings>} A promise that will
  * be resolved with the blessing.
  */
 BlessingStore.prototype.getDefault = function(ctx, cb) {
   return this._controller.blessingStoreDefault(ctx, cb);
 };

 /**
  * getPublicKey returns the public key of the Principal for which
  * this store hosts blessings.
  * @param {module:vanadium.context.Context} ctx The context.
  * @param {module:vanadium.security.BlessingStore~stringCb} cb An optional
  * callback that will return the public key as a string.
  * @return {Promise<string>} A promise that will
  * be resolved with the public key as a string.
  */
 BlessingStore.prototype.getPublicKey = function(ctx, cb) {
   return this._controller.blessingStorePublicKey(ctx, cb);
 };

 /**
  * getPeerBlessings returns all the blessings that the BlessingStore
  * currently holds for various peers.
  * @param {module:vanadium.context.Context} ctx The context.
  * @param {module:vanadium.security.BlessingStore~peerBlessingsCb} cb An
  * optional callback that will return the public key as a string.
  * @return {Promise<Map<module:vanadium.security~BlessingsPattern,
  * module:vanadium.security~Blessings>>} A promise that will
  * be resolved with the peer blessings.
  */
 BlessingStore.prototype.getPeerBlessings = function(ctx, cb) {
   var def = new Deferred(cb);
   var controller = this._controller;
   controller.blessingStorePeerBlessings(ctx)
   .then(function(peerBlessings) {
     var outPeerBlessings = new Map();
     var promises = [];
     peerBlessings.forEach(function(blessId, pattern) {
       var runtime = runtimeFromContext(ctx);
       promises.push(runtime.blessingsCache.blessingsFromId(blessId)
       .then(function(blessingsObj) {
         outPeerBlessings.set(pattern, blessingsObj);
       }));
     });
     return Promise.all(promises).then(function() {
       def.resolve(outPeerBlessings);
     });
   }).catch(function(err) {
     def.reject(err);
   });
   return def.promise;
 };

 /**
  * getDebugString return a human-readable string description of the store.
  * @param {module:vanadium.context.Context} ctx The context.
  * @param {module:vanadium.security.BlessingStore~stringCb} cb An optional
  * callback that will return the debug string.
  * @return {Promise<string>} A promise that will
  * be resolved with the debug string.
  */
 BlessingStore.prototype.getDebugString = function(ctx, cb) {
   return this._controller.blessingStoreDebugString(ctx, cb);
 };

},{"../../src/runtime/runtime-from-context":104,"../gen-vdl/v.io/v23/verror":57,"../lib/deferred":69}],116:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Registry for caveats. Provides a mapping between caveat
 * UUIDs and validations methods.
 * @private
 */

var vdl = require('../vdl');
var vom = require('../vom');
var byteUtil = require('../vdl/byte-util');
var standardCaveats = require('./standard-caveat-validators');
var vdlSecurity = require('../gen-vdl/v.io/v23/security');
var unwrapArg = require('../lib/unwrap-arg');
var InspectableFunction = require('../lib/inspectable-function');
var asyncCall = require('../lib/async-call');

module.exports = CaveatValidatorRegistry;

/**
 * @summary CaveatValidatorRegistry is a registry for caveats.
 * @description
 * It enables registration of caveat validation functions and provides
 * provides functionality to perform validation given UUIDs. This constructor
 * should not be invoked directly, but rather the
 * [singleton]{@link Runtime.caveatRegistry} on {@link Runtime} should be used.
 * @constructor
 * @inner
 * @memberof module:vanadium.security
 */
function CaveatValidatorRegistry() {
  this.validators = new Map();

  standardCaveats.registerDefaultCaveats(this);
}

/**
 * _makeKey generates a key for the given Uint8Array.
 * This is needed because ES6 map does === comparison and equivalent arrays
 * can be different under ===.
 * @private
 */
CaveatValidatorRegistry.prototype._makeKey = function(bytes) {
  return byteUtil.bytes2Hex(bytes);
};

/**
 * @callback CaveatValidationFunction
 * A function to validate caveats on {@link Blessings}
 * @param {module:vanadium.context.Context} ctx The context of the call.
 * @param {module:vanadium.security~SecurityCall} secCall The security call
 * to validate.
 * @memberof module:vanadium.security
 * @param {*} param Validation-function specific parameter.
 * @throws {Error} If validation fails.
 */

/**
 * Register a caveat validation function.
 * @param {module:vanadium.security.CaveatDescriptor} cavDesc The caveat
 * description.
 * @param {module:vanadium.security.CaveatValidationFunction} validateFn
 * The validation function.
 */
CaveatValidatorRegistry.prototype.register = function(cavDesc, validateFn) {
  this.validators.set(
    this._makeKey(cavDesc.id),
    new CaveatValidator(cavDesc, validateFn)
  );
};

/**
 * Perform validation on a caveat.
 * @param {module:vanadium.context.Context} ctx The context.
 * @param {module:vanadium.security.SecurityCall} secCall The security call.
 * @param {*} caveat The caveat to validate.
 * @param {Function} [cb] Callback after validation is complete.
 * See security/types.vdl
 * @throws {Error} If validation fails.
 * @private
 */
CaveatValidatorRegistry.prototype.validate =
  function(ctx, call, caveat, cb) {
  var validator = this.validators.get(this._makeKey(caveat.id));
  if (validator === undefined) {
    return cb(new vdlSecurity.CaveatNotRegisteredError(ctx,
      'Unknown caveat id: ' + this._makeKey(caveat.id)));
  }
  return vom.decode(caveat.paramVom, false, null, function(err, val) {
    if (err) {
      return cb(err);
    }
    return validator.validate(ctx, call, val, cb);
  });
};

/**
 * CaveatValidator is a helper object representing a specific caveat
 * description and function pair.
 * @private
 */
function CaveatValidator(cavDesc, validateFn) {
  this.cavDesc = cavDesc;
  this.validateFn = validateFn;
}

/**
 * @private
 */
CaveatValidator.prototype.validate = function(ctx, call, paramForValidator,
                                              cb) {
  var paramType = this.cavDesc.paramType;
  var canonParam = vdl.canonicalize.reduce(paramForValidator, paramType);
  var unwrappedParam = unwrapArg(canonParam, paramType);

  var inspectableFn = new InspectableFunction(this.validateFn);
  asyncCall(ctx, null, inspectableFn, [], [ctx, call, unwrappedParam], cb);
};

},{"../gen-vdl/v.io/v23/security":53,"../lib/async-call":67,"../lib/inspectable-function":72,"../lib/unwrap-arg":78,"../vdl":133,"../vdl/byte-util":125,"../vom":165,"./standard-caveat-validators":122}],117:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var vom = require('../vom');
var vdlSecurity = require('../gen-vdl/v.io/v23/security');

module.exports = {
  createCaveat: createCaveat,
  createConstCaveat: createConstCaveat,
  createExpiryCaveat: createExpiryCaveat,
  createMethodCaveat: createMethodCaveat,
  unconstrainedUse: createConstCaveat(true)
};

/**
 * createCaveat returns a [Caveat]{@link module:vanadium.security.Caveat}
 * that requires validation by the validation function correponding
 * to cavDesc and uses the provided parameters.
 * @param {module:vanadium.security.CaveatDescriptor} cavDesc The type of
 * caveat that is being created.
 * @param {*} data The data for the caveat.
 * @return module:vanadium.security.Caveat
 * @memberof module:vanadium.security
 */
function createCaveat(cavDesc, data) {
  return new vdlSecurity.Caveat({
    id: cavDesc.id,
    paramVom: vom.encode(data, cavDesc.paramType)
  });
}

/**
 * createConstCaveat returns a [Caveat]{@link module:vanadium.security.Caveat}
 * that validates iff value is true.
 * @param {boolean} value
 * @returns module:vanadium.security.Caveat
 * @memberof module:vanadium.security
 */
function createConstCaveat(value) {
  return createCaveat(vdlSecurity.ConstCaveat, value);
}

/**
 * createExpiryCaveat returns a [Caveat]{@link module:vanadium.security.Caveat}
 * that validates iff the current time is before t
 * @param {Date} expiryTime The time the caveat expires.
 * @returns module:vanadium.security.Caveat
 * @memberof module:vanadium.security
 */
function createExpiryCaveat(expiryTime) {
  return createCaveat(vdlSecurity.ExpiryCaveat, expiryTime);
}

/**
 * createMethodCaveat returns a [Caveat]{@link module:vanadium.security.Caveat}
 * that validates iff the method being invoked by the peer is listed in
 * methods array passed in.
 * @param {string[]} methods The methods that are allowed.
 * @returns module:vanadium.security.Caveat
 * @memberof module:vanadium.security
 */
function createMethodCaveat(methods) {
  return createCaveat(vdlSecurity.MethodCaveat, methods);
}

/**
 * unconstrainedUse returns a [Caveat]{@link module:vanadium.security.Caveat}
 * that never fails to validate.
 * @name unconstrainedUse
 * @returns module:vanadium.security.Caveat
 * @memberof module:vanadium.security
 */

},{"../gen-vdl/v.io/v23/security":53,"../vom":165}],118:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview A security information passes to authorizer and validator.
 * @private
 */
module.exports = createSecurityCall;

/**
 * Create a security call object. This exists so that we can resolve blessings
 * before the user is given the object.
 * @private
 */
function createSecurityCall(input, blessingsCache) {
  var call = new Call();
  call.method = input.method;
  call.suffix = input.suffix;
  call.methodTags = input.methodTags;
  call.localBlessingStrings = input.localBlessingStrings;
  call.remoteBlessingStrings = input.remoteBlessingStrings;
  // TODO(bjornick): Create endpoints.
  call.localEndpoint = input.localEndpoint;
  call.remoteEndpoint = input.remoteEndpoint;

  var promises = [];
  promises.push(blessingsCache.blessingsFromId(input.localBlessings)
  .then(function(localBlessings) {
    call.localBlessings = localBlessings;
  }));
  promises.push(blessingsCache.blessingsFromId(input.remoteBlessings)
  .then(function(remoteBlessings) {
    call.remoteBlessings = remoteBlessings;
    return call;
  }));

  return Promise.all(promises).then(function() {
    return call;
  });
}

/**
 * @summary Call defines the state available for authorizing a principal.
 * @name SecurityCall
 * @property {string} method The method being invoked.
 * @property {string} suffix The object name suffix of the request.
 * @property {module:vanadium.security~Blessings} localBlessings The blessings
 * bound to the local end.
 * @property {string} localBlessingStrings The validated names for the local
 * end.
 * @property {module:vanadium.security~Blessings} remoteBlessings The blessings
 * bound to the remote end.
 * @property {string} remoteBlessingStrings The validated names for the remote
 * end.
 * @property {string} localEndpoint The endpoint string for the local end.
 * @property {string} remoteEndpoint The endpoint string for the remote end.
 * @inner
 * @memberof module:vanadium.security
 */
function Call() {
}

Call.prototype.clone = function() {
  var res = Object.create(this.constructor.prototype);
  Object.defineProperty(res, 'constructor', { value: this.constructor });
  for (var key in this) {
    if (!this.hasOwnProperty(key)) {
      continue;
    }
    res[key] = this[key];
  }
  return res;
};

},{}],119:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var blessingMatches = require('./access/blessing-matching');
var vError = require('./../gen-vdl/v.io/v23/verror');

module.exports = defaultAuthorizer;

function defaultAuthorizer(ctx, call, cb) {
  // If the remoteBlessings has a public key, and it refers to ourselves
  // (i.e a self rpc), then we always authorize.
  if (call.remoteBlessings.publicKey &&
    call.localBlessings.publicKey === call.remoteBlessings.publicKey) {
    return cb();
  }
  var matches = call.localBlessingStrings.some(function(l) {
    return call.remoteBlessingStrings.some(function(r) {
      return blessingMatches(l, r) || blessingMatches(r, l);
    });
  });

  if (matches) {
    return cb();
  }
  return cb(new vError.NoAccessError(ctx, 'authorization failed'));
}

},{"./../gen-vdl/v.io/v23/verror":57,"./access/blessing-matching":108}],120:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
/**
 * @summary Namespace security provides an API for the Vanadium security
 * concepts defined in
 * {@link https://vanadium.github.io/concepts/security.html}.
 * @description
 * <p>Namespace security provides an API for the Vanadium security concepts
 * defined in
 * {@link https://vanadium.github.io/concepts/security.html}.
 * </p>
 *
 * <p>The primitives and APIs defined in this package enable bi-directional,
 * end-to-end authentication between communicating parties; authorization based
 * on that authentication; and secrecy and integrity of all communication.</p>
 * <p>The Vanadium security model is centered around the concepts of principals
 * and blessings.</p>
 * <p> A principal in the Vanadium framework is a public and private key pair.
 * Every RPC is executed on behalf of a principal. <p>
 * <p> A blessing is a binding of a human-readable name to a principal, valid
 * under some caveats, given by another principal. A principal can have
 * multiple blessings bound to it. For instance, a television principal may
 * have a blessing from the manufacturer (e.g., popularcorp:products:tv) as
 * well as from the owner (e.g., alice:devices:hometv). Principals are
 * authorized for operations based on the blessings bound to them.<p>
 * <p> A principal can "bless" another principal by binding an extension of one
 * of its own blessings to the other principal. This enables delegation of
 * authority. For example, a principal with the blessing "johndoe" can delegate
 * to his phone by blessing the phone as "johndoe:phone", which in-turn can
 * delegate to the headset by blessing it as "johndoe:phone:headset".</p>
 * <p> Caveats can be added to a blessing in order to restrict the contexts in
 * which it can be used. Amongst other things, caveats can restrict the
 * duration of use and the set of peers that can be communicated with using
 * a blessing.<p>
 * @namespace
 * @name security
 * @memberof module:vanadium
 */
var extend = require('xtend');

module.exports = extend(
  require('../gen-vdl/v.io/v23/security'),{
  access: require('./access'),
  createExpiryCaveat: require('./caveats').createExpiryCaveat,
  createMethodCaveat: require('./caveats').createMethodCaveat,
  createConstCaveat: require('./caveats').createConstCaveat,
  unconstrainedUse: require('./caveats').unconstrainedUse,
  createCaveat: require('./caveats').createCaveat,
  unionOfBlessings: require('./blessings-util').unionOfBlessings
});

},{"../gen-vdl/v.io/v23/security":53,"./access":109,"./blessings-util":113,"./caveats":117,"xtend":41}],121:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Principal stub for vanadium principals
 * @private
 */

var Deferred = require('../lib/deferred');
var BlessingStore = require('./blessingstore');
var verror = require('../gen-vdl/v.io/v23/verror');

/**
 * A callback that is called with either an error or a
 * [Blessings]{@link module:vanadium.security~Blessings} object.
 * @callback module:vanadium.security~Principal~blessingsCb
 * @param {Error} err If set, the error that occurred
 * @param {module:vanadium.security~Blessings} blessings The blessings result.
 */
/**
 * @summary Principal represents an entity capable of making or receiving RPCs.
 * @description <p>Principal represents an entity capable of making or receiving
 * RPCs. Principals have a unique (public, private) key pair, have blessings
 * bound to them and can bless other principals.</p>
 * <p>This constructor should not be used explicitly.  Instead, use the
 * principal property on the [runtime]{@link module:vanadium~Runtime}.
 * @constructor
 * @property {module:vanadium.security~BlessingStore} blessingStore The
 * blessing store.
 * @inner
 * @memberof module:vanadium.security
 */
function Principal(ctx, controller) {
  this._controller = controller;
  this._ctx = ctx;
  this.blessingStore = new BlessingStore(controller);
}

/**
 * <p>Bless binds extensions of blessings held by this principal to
 * another principal (represented by its public key).</p>
 *
 * <p>For example, a principal with the blessings "google:alice"
 * and "v23:alice" can bind the blessings "google:alice:friend"
 * and "v23:alice:friend" to another principal using:</p>
 * <pre>
 * bless(ctx, <other public key>, <google:alice, v23:alice>, 'friend', ...)
 * </pre>
 * @param {module:vanadium.context.Context} ctx The context.
 * @param {string} publicKey The public key to bless.
 * @param {module:vanadium.security~Blessings} blessing The blessings.
 * @param {string} extension The extension for the blessing.
 * @param {...module:vanadium.security.Caveat} caveats An array of Caveats to
 * restrict the blessing.
 * @param {module:vanadium.security~Principal~blessingsCb} cb An optional
 * callback that will return the blessing.
 * @return {Promise<module:vanadium.security~Blessings>} A promise that will be
 * resolved with the blessing.
 */
Principal.prototype.bless = function(ctx, publicKey, blessings,
  extension, firstCaveat /*, ...moreCaveats, cb*/) {
  // Extract the callback.
  var cb;
  var args = Array.prototype.slice.call(arguments);
  if (args.length > 0 &&
    typeof args[args.length - 1] === 'function') {
    cb = args[args.length - 1];
    args.pop();
  }

  var def = new Deferred(cb);

  // We must have at least one caveat.
  if (typeof firstCaveat !== 'object') {
    def.reject('At least one caveat must be specified. To bless without ' +
    'adding restrictions, use UnconstrainedUseCaveat');
    return def.promise;
  }

  var caveats = args.slice(4);

  this._controller.bless(ctx, publicKey, blessings, extension, caveats)
  .then(function(blessings) {
    def.resolve(blessings);
  }).catch(function(err) {
    def.reject(err);
  });

  return def.promise;
};

/**
 * BlessSelf creates a blessing with the provided name for this principal.
 * @param {module:vanadium.context.Context} ctx The context.
 * @param {string} name The name for the blessing.
 * @param {...module:vanadium.security.Caveat} caveats An array of Caveats to
 * restrict the blessing.
 * @param {module:vanadium.security~Principal~blessingsCb} cb An optional
 * callback that will return the blessing.
 * @return {Promise<module:vanadium.security~Blessings>} A promise that will be
 * resolved with the blessing.
 */
Principal.prototype.blessSelf = function(ctx, name /*, ...caveats, cb*/) {
  // Extract the callback.
  var cb;
  var args = Array.prototype.slice.call(arguments);
  if (args.length > 0 &&
    typeof args[args.length - 1] === 'function') {
    cb = args[args.length - 1];
    args.pop();
  }

  var def = new Deferred(cb);

  var caveats = args.slice(2);

  var controller = this._controller;
  controller.blessSelf(ctx, name, caveats)
  .then(function(blessings) {
    def.resolve(blessings);
  }).catch(function(err) {
    def.reject(err);
  });
  return def.promise;
};

/**
 * Add the provided blessing as a root.
 * @param {module:vanadium.context.Context} ctx The context.
 * @param {module:vanadium.security~Blessings} blessings The blessings object.
 * @param {module:vanadium~voidCb} cb If provided, the function
 * will be called on completion.
 * @return {Promise<void>} A promise that will be resolved/reject on completion.
 */
Principal.prototype.addToRoots = function(
  ctx, blessings, cb) {
  var def;
  if (blessings === undefined) {
    def = new Deferred(cb);
    def.reject(new verror.InternalError(this._ctx,
      'Blessings handle not specified'));
    return def.promise;
  }

  return this._controller.addToRoots(ctx, blessings, cb);
};

module.exports = Principal;

},{"../gen-vdl/v.io/v23/verror":57,"../lib/deferred":69,"./blessingstore":115}],122:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var vdlSecurity = require('../gen-vdl/v.io/v23/security');

// Register the default caveats from the security package.
module.exports = {
  registerDefaultCaveats: registerDefaultCaveats
};

function registerDefaultCaveats(registry) {
  registry.register(vdlSecurity.ConstCaveat,
    constCaveatValidator);
  registry.register(vdlSecurity.ExpiryCaveat,
    expiryCaveatValidator);
  registry.register(vdlSecurity.MethodCaveat,
    methodCaveatValidator);
}


function constCaveatValidator(ctx, call, value, cb) {
  if (!value) {
    return cb(new vdlSecurity.ConstCaveatValidationError(ctx));
  }
  cb();
}

function expiryCaveatValidator(ctx, call, expiry, cb) {
  var now = new Date();
  if (now.getTime() > expiry.getTime()) {
    return cb(new vdlSecurity.ExpiryCaveatValidationError(ctx,
      now, expiry));
  }
  cb();
}

function methodCaveatValidator(ctx, call, methods, cb) {
  if (!call.method || methods.length === 0) {
    return cb();
  }
  for (var i = 0; i < methods.length; i++) {
    if (call.method === methods[i]) {
      return cb();
    }
  }
  return cb(new vdlSecurity.MethodCaveatValidationError(call.context,
    call.method, methods));
}

},{"../gen-vdl/v.io/v23/security":53}],123:[function(require,module,exports){
(function (process){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 *  @fileoverview Public Vanadium API.
 *  @private
 */

var extend = require('xtend');
var isBrowser = require('is-browser');

var Deferred = require('./lib/deferred');
var runtime = require('./runtime');
var vlog = require('./lib/vlog');

var defaults = {
  appName: require('is-browser') ? window.location.host : 'untitled js app',
  authenticate: isBrowser,
  logLevel: vlog.levels.WARN,
  wspr: process.env.WSPR || (isBrowser ? null : 'http://localhost:8124')
};

/**
 * <p>Module vanadium defines the [Runtime]{@link module:vanadium~Runtime}
 * interface of the public Vanadium API
 * and its sub namespaces define the entire Vanadium public API.
 * It also defines the [init]{@link module:vanadium.init}
 * method which is used to initialize a
 * [runtime]{@link module:vanadium~Runtime} instance.</p>
 * <p>Once we reach a '1.0' version these public APIs will be stable over
 * an extended period and changes to them will be carefully managed to ensure
 * backward compatibility.</p>
 * <p>The current release is '0.1' and although we will do our best to maintain
 * backwards compatibility we can't guarantee that until we reach the '1.0'
 * milestone.
 * For more details about the Vanadium project,
 * please visit {@link https://github.com/vanadium/docs}.</p>
 * @module vanadium
*/

module.exports = {
  init: init,
  verror: require('./verror'),
  rpc: require('./rpc'),
  vlog: require('./lib/vlog'),
  naming: require('./naming'),
  security: require('./security'),
  context: require('./context'),
  vdl: require('./vdl'),
  vom: require('./vom'),
  uniqueId: require('./lib/uniqueid'),
  vtrace: require('./vtrace'),
  runtimeForContext: require('./runtime/runtime-from-context')
};

if (isBrowser) {
    module.exports.extension = require('./browser/extension-utils');
}
/**
 * Void callback is an callback that will be called on completion of an
 * async operation that has no results
 * @callback module:vanadium~voidCb
 * @param {Error} err If set, the error that occurred.
 */
/**
 * Callback passed into the {@link module:vanadium.init} that will be
 * called when the initialization has finished.
 * @callback module:vanadium~runtimeCb
 * @param {Error?} err If set, the error that occurred during
 * {@link module:vanadium.init}
 * @param {module:vandium~Runtime} rt The runtime that was constructed.
 */
/**
 * Creates a Vanadium [runtime]{@link module:vanadium~Runtime}.
 * @param {Object} config Configuration options
 * @param {module:vanadium~runtimeCb} [cb] If provided, the callback that will
 * be called on completion.
 * @return {Promise.<module:vanadium~Runtime>} A promise that resolves to the
 * new Runtime.
 * @memberof module:vanadium
 */
function init(config, cb) {
  if (typeof config === 'function') {
    cb = config;
    config = {};
  }

  config = extend(defaults, config);

  if (config.logLevel) {
    vlog.logger.level = config.logLevel;
  }

  var runtimeOpts = {
    appName: config.appName,
    namespaceRoots: config.namespaceRoots,
    proxy: config.proxy,
    wspr: config.wspr
  };

  var def = new Deferred(cb);

  // Validate config settings.
  if (isBrowser && config.wspr) {
    return def.reject(new Error('config.wspr requires NodeJS environment.'));
  }
  if (!isBrowser && !config.wspr) {
    return def.reject(new Error('config.wspr is required in NodeJS ' +
          'environment.'));
  }
  if (!isBrowser && config.authenticate) {
    return def.reject(new Error('config.authenticate requires browser ' +
          'environment'));
  }
  if (config.wspr && (config.namespaceRoots || config.proxy)) {
    return def.reject(new Error('Cannot set config.namespaceRoots or ' +
          'config.proxy when using wspr.  Use --v23.namespace.root ' +
          'and --v23.proxy flags to wsprd.'));
  }

  // If the user has set config.authenticate to true, get an authenticated
  // (blessed-by-Blessing-server) account for the user.  This requires the
  // Vanadium Chrome Extension to be installed and enabled.  The resulting
  // runtime will have runtime.accountName set of authenticated account.
  //
  // Otherwise, create a runtime with accountName 'unknown'.
  if (config.authenticate) {
    getAccount(function(err, accountName) {
      if (err) {
        return def.reject(err);
      }
      runtimeOpts.accountName = accountName;
      runtime.init(runtimeOpts, onRtInit);
    });
  } else {
    runtimeOpts.accountName = 'unknown';
    runtime.init(runtimeOpts, onRtInit);
  }

  function onRtInit(err, rt) {
    if (err) {
      return def.reject(err);
    }
    def.resolve(rt);
  }

  return def.promise;
}

// getAccounts tells the Vanadium Extension to start an OAuth flow, gets an
// access token for the user, and exchanges that access token for an account
// which is then associated with the origin of the web app.
//
// Once the extension has received the 'auth' message, it will perform the OAuth
// <-> WSPR identity flow, and respond with either an 'auth:success' message or
// an 'auth:error' message.
function getAccount(cb) {
  var extensionEventProxy = require('./browser/event-proxy');

  extensionEventProxy.sendRpc('auth', null, function(err, data) {
    if (err) {
      return cb(err);
    }
    return cb(null, data.account);
  });
}

}).call(this,require('_process'))
},{"./browser/event-proxy":43,"./browser/extension-utils":46,"./context":48,"./lib/deferred":69,"./lib/uniqueid":77,"./lib/vlog":79,"./naming":80,"./rpc":94,"./runtime":103,"./runtime/runtime-from-context":104,"./security":120,"./vdl":133,"./verror":151,"./vom":165,"./vtrace":173,"_process":11,"is-browser":33,"xtend":41}],124:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Definition of BigInt.
 * @private
 */

var ByteUtil = require('./byte-util.js');

module.exports = BigInt;

/**
 * @summary Represents an integer value of arbitrary size.
 * @memberof module:vanadium.vdl
 * @param {number} sign The sign of the number 1, -1 or 0.
 * @param {Uint8Array} uintBytes The backing byte array, in network byte order.
 * @constructor
 */
function BigInt(sign, uintBytes) {
  this._sign = sign;
  // Remove uppermost zero bytes.
  this._bytes = new Uint8Array(trimBytes(uintBytes)); // Copy trimmed bytes.
  Object.freeze(this);

  if (sign === 0 && this._bytes.length !== 0) {
    throw new Error('Sign is zero, but non-zero bytes \'' +
      ByteUtil.bytes2Hex(this._bytes) + '\' passed to constructor.');
  } else if (sign !== 0 && this._bytes.length === 0) {
    throw new Error('Non-zero sign ' + sign +
      ', but zero bytes passed to constructor.');
  } else if (sign !== 1 && sign !== -1 && sign !== 0) {
    throw new Error('sign ' + sign + ' not supported.');
  }
}

// Returns a subarray that excludes the uppermost zero bytes.
function trimBytes(bytes) {
  var i = 0;
  for (; i < bytes.length; i++) {
    if (bytes[i] !== 0) {
      break;
    }
  }
  return bytes.subarray(i);
}

/**
 * Create a BigInt from a native JavaScript number.
 * @param {number} val A native JavaScript value.
 * @throws {Error} If value cannot be represented as a BigInt.
 * @return {modules:vdl.BigInt} The BigInt representation.
 */
BigInt.fromNativeNumber = function(val) {
  if (typeof val !== 'number' || Math.round(val) !== val) {
    throw new Error('fromNativeNumber can only convert integer values ' +
      '(failing on ' + val + ')');
  }
  if (val > 9007199254740992 || val < -9007199254740992) {
    throw new Error('Cannot convert 0x' + val.toString(16) + ' to big int. ' +
      'Integers outside of (-2^53, 2^53)');
  }
  return convertFromNative(val);
};

/**
 * Approximates a BigInt from a native JavaScript number.
 * Caution: The conversion is not accurate for large numbers, non-integers, and
 * non-numerical inputs.
 * @param {number} val A native JavaScript value.
 * @return {modules:vanadium.vdl.BigInt} The BigInt representation.
 */
BigInt.fromNativeNumberApprox = function(val) {
  var floored;
  if (typeof val !== 'number') {
    floored = parseInt(val); // make an attempt to convert to an integer
  } else {
    floored = Math.floor(val);
  }
  return convertFromNative(floored);
};

// Converts from a number to a BigInt.
function convertFromNative(val) {
  // The input is an integer, if it is 0, the BigInt is also 0.
  if (val === 0) {
    return new BigInt(0, new Uint8Array(0));
  }

  // Go through each 4-byte chunk of |val|.
  var abs = Math.abs(val);
  var chunks = [];
  var CHUNK = 0x100000000;
  do {
    chunks.unshift(abs % CHUNK);
    abs /= CHUNK;
  } while (abs >= 1);

  // Use these chunks to construct a Uint8Array for the BigInt.
  var byteArr = new Uint8Array(4 * chunks.length);
  var dataView = new DataView(byteArr.buffer);
  for (var i = 0; i < chunks.length; i++) {
    dataView.setUint32(4 * i, chunks[i], false);
  }
  return new BigInt(_sign(val), byteArr);
}

/**
 * Generate a string representation of the BigInt.
 * This must have the same output format as the string conversion of normal
 * JavaScript integer (for the range of valid JavaScript integers).
 * @return {string} The string representation of the BigInt.
 */
BigInt.prototype.toString = function() {
  if (this._sign === 0) {
    return '0';
  }
  var val = this;
  var str = '';
  if (this._sign === -1) {
    val = this.negate();
    str = '-';
  }
  var ten = new BigInt(1, new Uint8Array([10]));
  var powerTen = new BigInt(1, new Uint8Array([0x01]));
  while (val.greaterThan(powerTen)) {
    powerTen = powerTen.multiply(ten);
  }
  // now powerTen >= val
  var outputtedNonzeroVal = false;
  while (powerTen._sign !== 0) {
    var amt = val.divide(powerTen);
    var nat = amt.toNativeNumber();
    if (nat !== 0) {
      str += nat.toString();
      outputtedNonzeroVal = true;
    } else if (outputtedNonzeroVal) {
      str += '0';
    }
    var subtractOff = powerTen.multiply(amt);
    val = val.subtract(subtractOff);
    powerTen = powerTen.divide(ten);
  }
  return str;
};

/**
 * Compares BigInt objects.
 * @param {modules:vanadium.vdl.BigInt} other The BigInt to compare with this
 * BigInt.
 * @return {boolean} True if this BigInt is greater than the argument BigInt.
 */
BigInt.prototype.greaterThan = function(other) {
  if (this._sign !== other._sign) {
    return this._sign > other._sign;
  }
  if (this._sign === 0) {
    return false;
  }
  if (this._bytes.length !== other._bytes.length) {
    return ((this._bytes.length - other._bytes.length) * this._sign) > 0;
  }
  for (var i = 0; i < this._bytes.length; i++) {
    if (this._bytes[i] > other._bytes[i]) {
      return this._sign > 0;
    }
    if (other._bytes[i] > this._bytes[i]) {
      return this._sign < 0;
    }
  }
  return false;
};

/**
 * Compares BigInt objects.
 * @param {modules:vanadium.vdl.BigInt} other The BigInt to compare with this
 * BigInt.
 * @return {boolean} True if this BigInt is greater than or equal to
 * the argument BigInt.
 */
BigInt.prototype.greaterThanEquals = function(other) {
  return this.greaterThan(other) || this.equals(other);
};

/**
 * Subtracts one BigInt from another.
 * @param {modules:vanadium.vdl.BigInt} other The BigInt to subtract from this
 * BigInt.
 * @return {modules:vanadium.vdl.BigInt} Returns a new BigInt equal to this
 * minus the argument BigInt.
 */
BigInt.prototype.subtract = function(other) {
  if (this._sign === 0) {
    return other.negate();
  }
  if (other._sign === 0) {
    return this;
  }
  if (this._sign === 1 && other._sign === -1) {
    return this.add(other.negate());
  }
  if (this._sign === -1 && other._sign === 1) {
    return other.add(this.negate()).negate();
  }

  var firstGeq = this.greaterThanEquals(other);
  var sign;
  if (firstGeq) {
    if (this.greaterThan(other)) {
      sign = 1;
    } else {
      sign = 0;
    }
  } else {
    sign = -1;
  }

  var greaterBytes = this._bytes;
  var lessBytes = other._bytes;
  if ((firstGeq && this._sign === -1) || (!firstGeq && this._sign === 1)) {
    greaterBytes = other._bytes;
    lessBytes = this._bytes;
  }

  var outArr = new Uint8Array(greaterBytes.length);

  var carry = 0;
  for (var place = 0; place < outArr.length; place++) {
    var outArrIndex = outArr.length - place - 1;
    var greaterIndex = greaterBytes.length - place - 1;
    var lessIndex = lessBytes.length - place - 1;

    var total = carry;
    if (greaterIndex >= 0) {
      total += greaterBytes[greaterIndex];
    }
    if (lessIndex >= 0) {
      total -= lessBytes[lessIndex];
    }
    if (total < 0) {
      carry = -1;
      total += 256;
    } else {
      carry = 0;
    }

    outArr[outArrIndex] = total;
  }

  return new BigInt(sign, outArr);
};

/**
 * Adds two BigInts together.
 * @param {modules:vanadium.vdl.BigInt} other The BigInt to add to this BigInt.
 * @return {modules:vanadium.vdl.BigInt} A new BigInt equal to this plus the
 * argument BigInt.
 */
BigInt.prototype.add = function(other) {
  if (this._sign === 0) {
    return other;
  }
  if (other._sign === 0) {
    return this;
  }
  if (this._sign === 1 && other._sign === -1) {
    return this.subtract(other.negate());
  }
  if (this._sign === -1 && other._sign === 1) {
    return other.subtract(this.negate());
  }

  var numBytesNeeded = Math.max(this._bytes.length, other._bytes.length);
  var outArr = new Uint8Array(numBytesNeeded);

  var carry = 0;
  for (var place = 0; place < outArr.length; place++) {
    var outArrIndex = outArr.length - place - 1;
    var thisIndex = this._bytes.length - place - 1;
    var otherIndex = other._bytes.length - place - 1;

    var total = carry;
    if (thisIndex >= 0) {
      total += this._bytes[thisIndex];
    }
    if (otherIndex >= 0) {
      total += other._bytes[otherIndex];
    }
    if (total >= 256) {
      carry = 1;
      total -= 256;
    } else {
      carry = 0;
    }

    outArr[outArrIndex] = total;
  }

  if (carry === 1) {
    var newArr = new Uint8Array(numBytesNeeded + 1);
    newArr.set(outArr, 1);
    newArr[0] = 0x01;
    outArr = newArr;
  }

  return new BigInt(this._sign, outArr);
};

/**
 * Multiplies BigInts.
 * @param {modules:vanadium.vdl.BigInt} other The BigInt to multiply with this
 * BigInt.
 * @return {modules:vanadium.vdl.BigInt} A new BigInt equal to this times the
 * argument BigInt.
 */
BigInt.prototype.multiply = function(other) {
  var total = new BigInt(0, new Uint8Array());
  for (var b = 0; b < this._bytes.length; b++) {
    var byteVal = this._bytes[b];
    for (var i = 0; i < 8; i++) {
      if ((byteVal & (1 << i)) !== 0) {
        var bit = i + (this._bytes.length - b - 1) * 8;
        var shiftedVal = other.leftShift(bit);
        total = total.add(shiftedVal);
      }
    }
  }
  if (this._sign === -1) {
    return total.negate();
  }
  return total;
};

/**
 * Divides BigInts
 * @param {modules:vanadium.vdl.BigInt} divisor The BigInt to use as the
 * divisor.
 * @return {modules:vanadium.vdl.BigInt} a new BigInt equalt to this divided by
 * the argument BigInt.
 */
BigInt.prototype.divide = function(divisor) {
  if (divisor._sign === 0) {
    return NaN;
  }
  if (divisor.abs().greaterThan(this.abs())) {
    return new BigInt(0, new Uint8Array());
  }
  var absDivisor = divisor.abs();
  var result = new Uint8Array(this._bytes.length);
  var remainder = new BigInt(0, new Uint8Array());
  for (var i = 0; i < this._bytes.length; i++) {
    for (var b = 7; b >= 0; b--) {
      remainder = remainder.leftShift(1);
      if ((this._bytes[i] & (1 << b)) !== 0) {
        remainder = remainder.add(new BigInt(1, new Uint8Array([1])));
      }
      if (remainder.greaterThanEquals(absDivisor)) {
        result[i] |= 1 << b;
        remainder = remainder.subtract(absDivisor);
      }
    }
  }

  return new BigInt(this._sign * divisor._sign, result);
};

/**
 * Negates the BigInt.
 * @return {modules:vanadium.vdl.BigInt} A new BigInt that is a negated version
 * this BigInt.
 */
BigInt.prototype.negate = function() {
  return new BigInt(-this._sign, this._bytes);
};

/**
 * Returns the absolute value of the BigInt.
 * @return {modules:vanadium.vdl.BigInt} A new BigInt equal to the absolute
 * value of this BigInt.
 */
BigInt.prototype.abs = function() {
  return new BigInt(Math.abs(this._sign), this._bytes);
};

function mostSignificantBitForByte(b) {
  var count = 0;
  if (b >= 0x10) {
    count += 4;
    b >>= 4;
  }
  if (b >= 0x04) {
    count += 2;
    b >>= 2;
  }
  if (b >= 0x02) {
    count += 1;
  }
  return count;
}

/**
 * Performs left shift of an arbitrary amount.
 * @param {number} amt The amount to shift in bits.
 * @return {modules:vanadium.vdl.BigInt} A new BigInt that is left shifted by
 * the specified amount.
 */
BigInt.prototype.leftShift = function(amt) {
  if (this._bytes.length === 0) {
    return this;
  }
  var spaceRemaining = 7 - mostSignificantBitForByte(this._bytes[0]);
  var extraSpaceNeeded = Math.ceil((amt - spaceRemaining) / 8);
  var spaceNeeded = extraSpaceNeeded + this._bytes.length;
  var result = new Uint8Array(spaceNeeded);

  var bitOffset = amt % 8;
  if (bitOffset === 0) {
    result.set(this._bytes);
  } else {
    var highLeftShift = bitOffset;
    var highMask = (1 << (8 - bitOffset)) - 1;
    var lowRightShift = 8 - bitOffset;
    var extraOffset = 0;
    if ((this._bytes[0] >> lowRightShift) > 0) {
      extraOffset = 1;
    }

    for (var i = 0; i < this._bytes.length; i++) {
      var b = this._bytes[i];
      if (i + extraOffset > 0) {
        result[i + extraOffset - 1] |= b >> lowRightShift;
      }
      result[i + extraOffset] |= ((b & highMask) << highLeftShift);
    }
  }
  return new BigInt(this._sign, result);
};

/**
 * Determine if this BigInt is equal to another BigInt.
 *
 * @param {modules:vanadium.vdl.BigInt} other The other BigInt to compare.
 * @return {boolean} true if this BigInt is equal to the other BigInt. false
 * otherwise.
 */
BigInt.prototype.equals = function(other) {
  if (this.getSign() !== other.getSign()) {
    return false;
  }

  var thisBytes = this.getUintBytes();
  var otherBytes = other.getUintBytes();

  if (thisBytes.length !== otherBytes.length) {
    return false;
  }
  for (var i = 0; i < thisBytes.length; i++) {
    if (thisBytes[i] !== otherBytes[i]) {
      return false;
    }
  }
  return true;
};

/**
 * Gets the sign of this BigInt.
 * @return {sign} 1 if positive, 0 if zero, -1 if negative.
 */
BigInt.prototype.getSign = function() {
  return this._sign;
};

/**
 * Gets the uint byte value of this big int.
 * This method trims upper zero bytes.
 * @return {Uint8Array} The uint bytes.
 */
BigInt.prototype.getUintBytes = function() {
  return this._bytes;
};

/**
 * Convert to a native JavaScript float64 representation.
 * @throws {Error} if the value cannot be converted to a float64 without loss.
 * @return {number} a native JavaScript float64 representation of the BigInt.
 */
BigInt.prototype.toNativeNumber = function() {
  if (this._largerThanMaxLosslessInteger()) {
    throw new Error('BigInt \'' + ByteUtil.bytes2Hex(this) +
      '\' out of range of native JavaScript numbers');
  }
  return this._convertToNative();
};

/**
 * Approximate the native JavaScript float64 representation.
 * Caution: The conversion is not accurate when the BigInt is larger than the
 * maximum lossless integer.
 * @return {number} a native JavaScript float64 representation of the BigInt.
 */
BigInt.prototype.toNativeNumberApprox = function() {
  return this._convertToNative();
};

/**
 * @private
 * @return {number} a native JavaScript float64 representation of the BigInt.
 */
BigInt.prototype._convertToNative = function() {
  var arr = new Uint8Array(4);
  var copySrcIndex = this._bytes.length - Math.min(this._bytes.length, 4);
  var copyDstIndex = Math.max(4 - this._bytes.length, 0);
  arr.set(this._bytes.subarray(copySrcIndex), copyDstIndex);
  var view = new DataView(arr.buffer);
  var lowerVal = view.getUint32(0, false);
  if (this._bytes.length <= 4) {
    return this._sign * lowerVal;
  }
  copySrcIndex = this._bytes.length - Math.min(this._bytes.length, 8);
  copyDstIndex = Math.max(8 - this._bytes.length, 0);
  var copyableLength = Math.min(this._bytes.length - 4, 4);
  var arr2 = new Uint8Array(4);
  arr2.set(this._bytes.subarray(copySrcIndex, copySrcIndex + copyableLength),
    copyDstIndex);
  var view2 = new DataView(arr2.buffer);
  var upperVal = view2.getUint32(0, false);
  var combinedVal = upperVal * 0x100000000 + lowerVal;
  return this._sign * combinedVal;
};

/**
 * @private
 * @return true if abs(this) > 2^53, false otherwise.
 */
BigInt.prototype._largerThanMaxLosslessInteger = function() {
  if (this._bytes.length >= 8) {
    return true;
  }
  if (this._bytes.length <= 6) {
    return false;
  }
  if (this._bytes[0] > 0x20) {
    return true;
  }

  if (this._bytes[0] === 0x20) {
    for (var i = 1; i <= 6; i++) {
      if (this._bytes[i] !== 0) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Get the sign of the value.
 * @private
 * @param {number} val Input value.
 * @return {number} 1, -1, or 0 depending on the sign of the input.
 */
function _sign(val) {
  if (val > 0) {
    return 1;
  } else if (val < 0) {
    return -1;
  }
  return 0;
}

},{"./byte-util.js":125}],125:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Utilities for manipulating bytes.
 * @private
 */

 module.exports = {
  emptyOrAllZero: emptyOrAllZero,
  allOne: allOne,
  shiftLeftOne: shiftLeftOne,
  shiftRightOne: shiftRightOne,
  twosComplement: twosComplement,
  decrement: decrement,
  increment: increment,
  bytes2Hex: bytes2Hex,
  hex2Bytes: hex2Bytes
};

/**
 * Checks if the array of bytes is all zero or empty.
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return {boolean} true if the array is all zero or empty. false otherwise.
 */
function emptyOrAllZero(bytes) {
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x00) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if the array of bytes is all one bits (0xff bytes).
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return {boolean} true if the array is all one. false otherwise.
 */
function allOne(bytes) {
  if (bytes.length === 0) {
    return false;
  }
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0xff) {
      return false;
    }
  }
  return true;
}

/**
 * Shifts the bytes to the left by one bit.
 * This may mutate the input array.
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return the left shifted byte array.
 */
function shiftLeftOne(bytes) {
  if (emptyOrAllZero(bytes)) {
    return bytes;
  }
  if ((bytes[0] & 0x80) !== 0) {
    // Expand the array because the shift will lose the upper bit.
    var largerArray = new Uint8Array(bytes.length + 1);
    largerArray.set(bytes, 1);
    bytes = largerArray;
  }
  for (var i = 0; i < bytes.length - 1; i++) {
    var val = bytes[i] << 1;
    val = val | (bytes[i + 1] & 0x80) >>> 7;
    bytes[i] = val;
  }
  bytes[bytes.length - 1] = bytes[bytes.length - 1] << 1;
  return bytes;
}

/**
 * Shifts the bytes to the right by one bit.
 * This mutates the input array.
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return the right shifted byte array.
 */
function shiftRightOne(bytes) {
  var topBit = 0;
  for (var i = 0; i < bytes.length; i++) {
    var nextTopBit = (bytes[i] & 0x01) << 7;
    bytes[i] = (bytes[i] >>> 1) | topBit;
    topBit = nextTopBit;
  }
  return bytes;
}

/**
 * Computes the two's complement of the value in the byte array.
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return the two's complemented byte array
 */
function twosComplement(bytes) {
  var flipped = false;
  for (var i = bytes.length - 1; i >= 0; i--) {
    if (flipped) {
      bytes[i] = ~bytes[i];
    } else {
      if (bytes[i] !== 0) {
        bytes[i] = 0x100 - bytes[i];
        flipped = true;
      }
    }
  }
  return bytes;
}

/**
 * Decrements the input byte array by 1.
 * This mutates the input array.
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return the decremented byte array.
 */
function decrement(bytes) {
  if (emptyOrAllZero(bytes)) {
    throw new Error('Decrement of zero not supported');
  }
  for (var i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === 0) {
      bytes[i] = 0xff;
    } else {
      bytes[i] = bytes[i] - 1;
      break;
    }
  }
  return bytes;
}

/**
 * Increments the input byte array by 1.
 * This mutates the input array.
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return the incremented byte array.
 */
function increment(bytes) {
  if (bytes.length === 0) {
    return new Uint8Array([0x01]);
  }
  if (allOne(bytes)) {
    // Expand the array because the shift will lose the upper bit.
    var largerArray = new Uint8Array(bytes.length + 1);
    largerArray.set(bytes, 1);
    bytes = largerArray;
  }
  for (var i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === 0xff) {
      bytes[i] = 0x00;
    } else {
      bytes[i] = bytes[i] + 1;
      break;
    }
  }
  return bytes;
}

/**
 * Converts the input byte array to a hex representation.
 * @private
 * @param {Uint8Array} bytes the input byte array.
 * @return {string} a hex string representation of the input array.
 */
function bytes2Hex(arr) {
  var hexString = '';
  for (var i = 0; i < arr.length; i++) {
    var str = arr[i].toString(16);
    if (str.length === 1) {
      str = '0' + str;
    }
    hexString += str;
  }
  return hexString;
}

/**
 * Converts the input hex string to a byte array.
 * @private
 * @param {string} hexString the input hex string.
 * @return {Uint8Array} the byte array representation of the hex string.
 */
function hex2Bytes(hexString) {
  if (hexString.length % 2 !== 0) {
    throw new Error('Even length string required.');
  }
  var arr = new Uint8Array(hexString.length / 2);
  for (var i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hexString.substring(i*2, (i+1)*2), 16);
  }
  return arr;
}

},{}],126:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Defines a canonicalizer that returns a validated value ready
 * for encoding. Any undefined values will be filled with their corresponding
 * zero-values. This validated value is a modified copy of the given value.
 * Canonicalizing a canonicalized value with the same type is a no-op.
 * @private
 */

/**
 * @name canonicalize
 * @summary Namespace canonicalize implements utilities to canonicalize vdl
 * types for use in encoding and decoding values.
 * @description Namespace canonicalize implements utilities to canonicalize vdl
 * types for use in encoding and decoding values.
 * @namespace
 * @memberof module:vanadium.vdl
 */

var BigInt = require('./big-int.js');
var Complex = require('./complex.js');
var kind = require('./kind.js');
var registry; // Must be lazily required to avoid circular dependency.
var types = require('./types.js');
var Type = require('./type.js');
var TypeUtil = require('./type-util.js');
var guessType = require('./guess-type.js');
var jsValueConvert = require('./js-value-convert.js');
var overflow = require('./overflow.js');
var util = require('./util.js');
var stringify = require('./stringify.js');
var typeCompatible = require('./type-compatible.js');
var typeObjectFromKind = require('./type-object-from-kind.js');
var nativeTypeRegistry = require('./native-type-registry');
require('./es6-shim');

module.exports = {
  value: canonicalizeExternal,
  type: canonicalizeTypeExternal,
  zero: canonicalizeZero,
  construct: canonicalizeConstruct,
  fill: canonicalizeFill,
  reduce: canonicalizeReduce
};

// Define the zero BigInt a single time, for use in the zeroValue function.
var ZERO_BIGINT = new BigInt(0, new Uint8Array());


/**
 * Creates a new copy of inValue that is the canonical wire format of inValue.
 * @function
 * @name fill
 * @memberof module:vanadium.vdl.canonicalize
 * @param {*} inValue The value to convert to the wire format.
 * @param {module:vanadium.vdl.Type} t The type of inValue.
 * @return {*} The canonical wire format of inValue.
 */
function canonicalizeFill(inValue, t) {
  return canonicalizeExternal(inValue, t, true, false);
}

/**
 * Creates a new copy of inValue that is a constructor's in-memory format of
 * inValue. Unlike reduce, it does not convert the copy to its native form.
 * @function
 * @name construct
 * @memberof module:vanadium.vdl.canonicalize
 * @param {*} inValue The value to convert to the flattened wire format.
 * @param {module:vanadium.vdl.Type} t The type of inValue.
 * @return {*} The canonical in-format of inValue.
 */
function canonicalizeConstruct(inValue, t) {
  return canonicalizeExternal(inValue, t, false, false);
}

/**
 * Creates a new copy of inValue that is the canonical in-memory format of
 * inValue.
 * @function
 * @name reduce
 * @memberof module:vanadium.vdl.canonicalize
 * @param {*} inValue The value to convert to the in memory format.
 * @param {module:vanadium.vdl.Type} t The type of inValue.
 * @return {*} The canonical in-format of inValue.
 */
function canonicalizeReduce(inValue, t) {
  return canonicalizeExternal(inValue, t, false, true);
}

/**
 * Alias for canonicalizeExternal with inValue = undefined.
 * @private
 */
function canonicalizeZero(t, deepWrap, toNative) {
  return canonicalizeExternal(undefined, t, deepWrap, toNative);
}

/**
 * Examines the given value and uses the type to return a canonicalized value.
 * The canonicalization process fills in zero-values wherever needed.
 * If the given value is undefined, its zero-value is returned.
 * TODO(alexfandrianto): The performance is on the same order as encode, but it
 * would be a good idea to consider adding more improvements.
 * @private
 * @param {*} inValue The value to be canonicalized.
 * @param {module:vanadium.vdl.Type} t The target type.
 * @param {boolean=} deepWrap Whether or not to deeply wrap the contents.
 * @param {boolean=} toNative Whether or not the final result needs to be
 * converted to a native value.
 * @return {*} The canonicalized value. May potentially refer to v.
 */
function canonicalizeExternal(inValue, t, deepWrap, toNative) {
  if (deepWrap === undefined) {
    deepWrap = true;
  }
  if (toNative === undefined) {
    toNative = !deepWrap;
  }

  // Canonicalize the given value as a top-level value.
  var inType = TypeUtil.isTyped(inValue) ? inValue._type : undefined;
  return canonicalize(inValue, inType, t, deepWrap, new Map(), true, toNative);
}

/**
 * Helper function for canonicalizeExternal.
 * Keeps track of a Map of old references to new references. This helps clone
 * cycles and preserve shared references.
 * @private
 * @param {*} v The value to be canonicalized.
 * @param {module:vanadium.vdl.Type} inType The inferred type of the value.
 * This type is tracked in order to ensure that internal any keys/elems/fields
 * are properly filled in with type information.
 * @param {module:vanadium.vdl.Type} t The target type.
 * @param {boolean} deepWrap Whether or not to deeply wrap the contents.
 * @param {object} seen A cache from old to new
 * references that based on type.
 * @param {boolean} topLevel If true, then the return value is wrapped.
 * @param {boolean} toNative Whether or not the final result needs to be
 * converted to a native value.
 * @return {*} The canonicalized value. May potentially refer to v.
 */
function canonicalize(inValue, inType, t, deepWrap, seen, topLevel, toNative) {
  if (!(t instanceof Type)) {
    t = new Type(t);
  }

  // This value needs a wrapper if either flag is set.
  var needsWrap = deepWrap || topLevel;

  // Special case JSValue. Convert the inValue to JSValue form.
  var isJSValue = types.JSVALUE.equals(t);
  if (isJSValue) {
    inValue = jsValueConvert.fromNative(inValue);
  }
  // Special case Native Value. Convert the inValue to its wire form.
  var isNative = nativeTypeRegistry.hasNativeType(t);
  if (isNative) {
    inValue = nativeTypeRegistry.fromNativeValue(t, inValue);
  }

  // Check for type convertibility; fail early if the types are incompatible.
  if (!typeCompatible(inType, t)) {
    if (inType.kind !== kind.TYPEOBJECT) {
      throw new TypeError(inType + ' and ' + t +
        ' are not compatible');
    }
  }

  // If the inType is ANY and inValue's type is ANY, then unwrap and try again.
  // This allows any(foo) to be converted to foo.
  if (types.ANY.equals(inType) && TypeUtil.isTyped(inValue) &&
    types.ANY.equals(inValue._type)) {

    return canonicalize(TypeUtil.unwrap(inValue), inValue._type, t, deepWrap,
      seen, topLevel, toNative);
  }

  // Special case TypeObject. See canonicalizeType.
  if (t.kind === kind.TYPEOBJECT) {
    return canonicalizeType(inValue, seen);
  }

  // The outValue is an object associated with a constructor based on its type.
  // We pre-allocate wrapped values and add them to seen so that they can be
  // referenced in canonicalizeInternal (types may have recursive references).
  var outValue = getObjectWithType(t, inValue);
  var cacheType = outValue._type;

  // Only top-level values and primitives should be wrapped unless deep wrapping
  // is enabled; in this case outValue, is set to null.
  if (!needsWrap && outValue._wrappedType) {
    outValue = null;
  }

  // Seen maps an inValue and type to an outValue.
  // If the inValue and type combination already have a cached value, then that
  // is returned. Otherwise, the outValue is put into the seen cache.
  // This ensures that shared references are preserved by canonicalize.
  var cached = getFromSeenCache(seen, inValue, cacheType);
  if (cached !== undefined) {
    return cached;
  }
  var shouldCache = (inValue !== null && typeof inValue === 'object' &&
    outValue !== null);
  if (shouldCache) {
    insertIntoSeenCache(seen, inValue, cacheType, outValue);
  }

  // Call canonicalizeInternal to perform the bulk of canonicalization.
  // canonValue === outValue in the case of Objects, but not primitives.
  // TODO(alexfandrianto): A little inaccurate. Map/Set/Array/Uint8Array, etc.
  // These are all considered primitive at the moment, but they can attach an
  // _type as a field using Object.define.
  var canonValue;
  var v;
  if (t.kind === kind.ANY) {
    // TODO(alexfandrianto): This logic is complex and unwieldy.
    // See https://github.com/veyron/release-issues/issues/1149

    // The inValue could be wrapped, unwrapped, or potentially even multiply
    // wrapped with ANY. Unwrap the value and guess its type.
    var dropped = unwrapAndGuessType(inValue);
    v = dropped.unwrappedValue;

    // Note: guessType is types.ANY whenever v is null or undefined.
    // However, we should use inType if present.
    var guessedType = dropped.guessedType;
    if (inType && inType.kind !== kind.ANY) {
      guessedType = inType;
    }

    if (guessedType.kind === kind.ANY) {
      canonValue = null;
    } else {
      // The value inside an ANY needs to be canonicalized as a top-level value.
      canonValue = canonicalize(v, guessedType, guessedType, deepWrap, seen,
        true, toNative);
    }
  } else {
    v = TypeUtil.unwrap(inValue);
    canonValue = canonicalizeInternal(v, inType, t, deepWrap, seen, outValue);
  }

  // We need to copy the msg field of WireError to the message property of
  // Javascript Errors so that toString() works.
  // TODO(bjornick): We should make this go away when we fix:
  // https://github.com/veyron/release-issues/issues/1279
  if (canonValue instanceof Error) {
    if (!canonValue.message) {
      Object.defineProperty(canonValue, 'message', { value: canonValue.msg });
    }
    if (!canonValue.stack) {
      Object.defineProperty(canonValue, 'stack', { value: inValue.stack });
    }
  }
  // Non-structLike types may need to wrap the clone with a wrapper constructor.
  if (needsWrap && outValue !== null && outValue._wrappedType) {
    outValue.val = canonValue;
    return outValue;
  }

  // Special case JSValue. If toNative, convert the canonValue to native form.
  if (isJSValue && toNative) {
    return jsValueConvert.toNative(canonValue);
  }
  // Special case Native Value. If toNative, return to native form.
  if (isNative && toNative) {
    return nativeTypeRegistry.fromWireValue(t, canonValue);
  }

  return canonValue;
}

/**
 * Helper function for canonicalize, which canonicalizes and validates on an
 * unwrapped value.
 * @private
 */
function canonicalizeInternal(v, inType, t, deepWrap, seen, outValue) {

  // Any undefined value obtains its zero-value.
  if (v === undefined) {
    var zero = zeroValue(t);

    // The deepWrap flag affects whether the zero value needs internal wrapping.
    // Without it, the zero value is correct.
    if (!deepWrap) {
      return TypeUtil.unwrap(canonicalize(zero, inType, t, false, seen, false,
        true));
    }

    // Otherwise, canonicalize but remove the top-level wrapping.
    // The top-level will be reapplied by this function's caller.
    return TypeUtil.unwrap(canonicalize(zero, inType, t, true, seen, false,
      false));
  } else if (v === null && (t.kind !== kind.ANY && t.kind !== kind.OPTIONAL)) {
    throw makeError(v, t, 'value is null for non-optional type');
  }

  var inKeyType = inType ? inType.key : undefined;
  var inElemType = inType ? inType.elem : undefined;
  var inFieldType;
  var key;
  var i;
  // Otherwise, the value is defined; validate it and canonicalize the value.
  switch(t.kind) {
    case kind.ANY:
      // Any values are canonicalized with their internal value instead.
      throw new Error('Unreachable; Any values are always extracted and then ' +
        'canonicalized.');
    case kind.OPTIONAL:
      // Verify the value is null or the correct Optional element.
      if (v === null) {
        return null;
      }
      return canonicalize(v, inElemType, t.elem, deepWrap, seen, false,
        !deepWrap);
    case kind.BOOL:
      // Verify the value is a boolean.
      if (typeof v !== 'boolean') {
        throw makeError(v, t, 'value is not a boolean');
      }
      return v;
    case kind.BYTE:
    case kind.UINT16:
    case kind.UINT32:
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
    case kind.FLOAT32:
    case kind.FLOAT64:
      // Verify this is a valid number value and then convert.
      if (typeof v === 'number' || v instanceof BigInt || isComplex(v)) {

        // These numbers must be real.
        assertRealNumber(v, t);

        // Non-floats must be integers.
        if (t.kind !== kind.FLOAT32 && t.kind !== kind.FLOAT64) {
          assertInteger(v, t);
        }

        // Uints must be non-negative.
        if (t.kind === kind.BYTE || t.kind === kind.UINT16 ||
          t.kind === kind.UINT32) {

          assertNonNegativeNumber(v, t);
        }

        // This also filters out numbers that exceed their bounds.
        return convertToNativeNumber(v, t);
      }
      throw makeError(v, t, 'value is not a number');
    case kind.UINT64:
    case kind.INT64:
      // Verify this is a valid number value and then convert.
      if (typeof v === 'number' || v instanceof BigInt || isComplex(v)) {

        // These numbers must be real integers.
        assertRealNumber(v, t);
        assertInteger(v, t);
        if (t.kind === kind.UINT64) {
          assertNonNegativeNumber(v, t); // also non-negative
        }
        return convertToBigIntNumber(v, t);
      }
      throw makeError(v, t, 'value is not a number or BigInt');
    case kind.COMPLEX64:
    case kind.COMPLEX128:
      if (typeof v === 'number' || v instanceof BigInt || isComplex(v)) {
        return convertToComplexNumber(v, t);
      }
      throw makeError(v, t, 'value is not a number or object of the form ' +
        '{ real: <number>, imag: <number> }');
    case kind.STRING:
    case kind.ENUM:
      // Determine the string representation.
      var str;
      if (typeof v === 'string') {
        str = v;
      } else if (v instanceof Uint8Array) {
        str = uint8ArrayToString(v);
      } else {
        throw makeError(v, t, 'value cannot convert to string');
      }

      // For enums, check that the string actually appears in the labels.
      if (t.kind === kind.ENUM && t.labels.indexOf(str) === -1) {
        throw makeError(v, t, 'value refers to unexpected label: ' + v);
      }
      return str;
    case kind.TYPEOBJECT:
      // TypeObjects are canonicalized with a fake type, so they should never
      // reach this case.
      throw new Error('Unreachable; TypeObjects use canonicalizeType.');
    case kind.LIST:
    case kind.ARRAY:
      // Verify the list/array and its internal contents.
      // Values whose length exceeds the array length cannot convert.
      var neededLen = v.length;
      if (t.kind === kind.ARRAY) {
        if (v.length > t.len) {
          throw makeError(v, t, 'value has length ' + v.length +
            ', which exceeds type length ' + t.len);
        }
        neededLen = t.len;
      }

      // Special-case: Byte slices and byte arrays are treated like strings.
      if (t.elem.kind === kind.BYTE) {
        // Then v can be a string or Uint8Array.
        if (v instanceof Uint8Array) {
          return v;
        }
        if (typeof v === 'string') {
          return uint8ArrayFromString(v, neededLen);
        }
        throw makeError(v, t, 'value is not Uint8Array or string');
      }

      // Check to be sure that we have a normal array.
      if (!Array.isArray(v)) {
        throw makeError(v, t, 'value is not an Array');
      }

      // Fill a placeholder with the canonicalized internal values of the array.
      outValue = new Array(neededLen);
      for (var arri = 0; arri < neededLen; arri++) {
        outValue[arri] = canonicalize(v[arri], inElemType, t.elem, deepWrap,
          seen, false, !deepWrap);
      }
      return outValue;
    case kind.SET:
      // Verify that the value can be converted to an ES6 Set; return that copy.
      if (typeof v !== 'object') {
        throw makeError(v, t, 'value is not an object');
      } else if (v instanceof Map) {
        // Map is allowed to convert to Set, but it could fail.
        v = mapToSet(v, t);
      } else if (!(v instanceof Set) && !Array.isArray(v)) {
        if (t.key.kind !== kind.STRING) {
          throw makeError(v, t, 'cannot encode Object as VDL set with ' +
            'non-string key type. Use Set instead.');
        }
        v = objectToSet(v);       // v now refers to a Set instead of an Object.
        inKeyType = types.STRING; // Object keys are strings.
      }

      // Recurse: Validate internal keys.
      outValue = new Set();
      v.forEach(function(value) {
        outValue.add(canonicalize(value, inKeyType, t.key, deepWrap, seen,
          false, !deepWrap));
      });

      return outValue;
    case kind.MAP:
      var useInTypeForElem = false; // Only used for struct/object => Map.

      // Verify that the value can be converted to an ES6 Map; return that copy.
      if ((typeof v !== 'object') || Array.isArray(v)) {
        throw makeError(v, t, 'value is not a valid Map-type');
      } else if (v instanceof Set) {
        // Sets can always upconvert to Maps.
        v = setToMap(v);
        inElemType = types.BOOL; // Set should use bool as elem type.
      } else if (!(v instanceof Map)) {
        if (t.key.kind !== kind.STRING) {
          throw makeError(v, t, 'cannot encode Object as VDL map with ' +
           'non-string key type. Use Map instead.');
        }
        v = objectToMap(v);       // v now refers to a Map instead of an Object.
        inKeyType = types.STRING; // Object keys are strings.
        // inElemType might change every time though! Set a flag.
        useInTypeForElem = true;
      }

      // Recurse: Validate internal keys and values.
      outValue = new Map();
      v.forEach(function(val, key) {
        if (useInTypeForElem && inType && inType.kind === kind.STRUCT) {
          inElemType = lookupFieldType(inType, key);
        }
        outValue.set(
          canonicalize(key, inKeyType, t.key, deepWrap, seen, false, !deepWrap),
          canonicalize(val, inElemType, t.elem, deepWrap, seen, false,
            !deepWrap)
        );
      });

      return outValue;
    case kind.STRUCT:
      // Verify that the Struct and all its internal fields.
      // TODO(alexfandrianto): We may want to disallow other types of objects
      // (e.g., Uint8Array, Complex, and BigInt).
      if (typeof v !== 'object' || Array.isArray(v)) {
        throw makeError(v, t, 'value is not an Object');
      }

      // Copy over any private properties without canonicalization.
      copyUnexported(v, outValue);

      var fields = t.fields;
      for (i = 0; i < fields.length; i++) {
        var fieldName = fields[i].name;
        var fieldNameLower = util.uncapitalize(fieldName);
        var fieldType = fields[i].type;

        // Gather the correct struct entry (or Map/Set entry) and field type.
        inFieldType = lookupFieldType(inType, fieldName);
        var fieldVal = v[fieldNameLower];
        if (v instanceof Map) {
          fieldVal = v.get(fieldName);
        } else if (v instanceof Set) {
          fieldVal = v.has(fieldName);
        }

        // Each entry needs to be canonicalized too.
        outValue[fieldNameLower] = canonicalize(fieldVal, inFieldType,
          fieldType, deepWrap, seen, false, !deepWrap);
      }

      return outValue;
    case kind.UNION:
      // Verify that the Union contains 1 field, 0-filling if there are none.
      if (typeof v !== 'object' || Array.isArray(v)) {
        throw makeError(v, t, 'value is not an object');
      }

      // TODO(bprosnitz): Ignores properties not defined by the Union type.
      // If we want to throw in such cases, _type would have to be whitelisted.
      var isSet = false;
      for (i = 0; i < t.fields.length; i++) {
        key = t.fields[i].name;
        var lowerKey = util.uncapitalize(key);
        if (v.hasOwnProperty(lowerKey) && v[lowerKey] !== undefined) {
          // Increment count and canonicalize the internal value.
          if (isSet) {
            throw makeError(v, t, '>1 Union fields are set');
          } else {
            // The field indexes may not match, so get the field type by name.
            inFieldType = lookupFieldType(inType, key);
            outValue[lowerKey] = canonicalize(v[lowerKey], inFieldType,
              t.fields[i].type, deepWrap, seen, false, !deepWrap);
            isSet = true;
          }
        }
      }

      // If none of the fields were set, then the Union is not valid.
      if (!isSet) {
        throw makeError(v, t, 'none of the Union fields are set');
      }

      // Copy over any private properties without canonicalization.
      copyUnexported(v, outValue);

      return outValue;
    default:
      throw new TypeError('Unknown kind ' + t.kind);
  }
}

/**
 * Use the type and its kind to find the proper 0-value.
 * TODO(alexfandrianto): Assumes the type given is valid. Should we validate?
 * For example, we assume all lists lack a len field in their type.
 * zeroValues need further canonicalization, so it would make sense to have it
 * be a simple initializer instead of being recursive.
 * @param(Type) t The type whose zero value is needed.
 * @return {*} the corresponding zero value for the input type.
 * @private
 */
function zeroValue(t) {
  switch(t.kind) {
    case kind.ANY:
    case kind.OPTIONAL:
      return null;
    case kind.BOOL:
      return false;
    case kind.BYTE:
    case kind.UINT16:
    case kind.UINT32:
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
    case kind.FLOAT32:
    case kind.FLOAT64:
      return 0;
    case kind.UINT64:
    case kind.INT64:
      return ZERO_BIGINT;
    case kind.COMPLEX64:
    case kind.COMPLEX128:
      return new Complex(0, 0);
    case kind.STRING:
      return '';
    case kind.ENUM:
      return t.labels[0];
    case kind.TYPEOBJECT:
      return types.ANY;
    case kind.ARRAY:
    case kind.LIST:
      var len = t.len || 0;
      if (t.elem.kind === kind.BYTE) {
        return new Uint8Array(len);
      }
      var arr = new Array(len);
      for (var arri = 0; arri < len; arri++) {
        arr[arri] = zeroValue(t.elem);
      }
      return arr;
    case kind.SET:
      return new Set();
    case kind.MAP:
      return new Map();
    case kind.UNION:
      var zeroUnion = {};
      var name = util.uncapitalize(t.fields[0].name);
      zeroUnion[name] = zeroValue(t.fields[0].type);
      return zeroUnion;
    case kind.STRUCT:
      return t.fields.reduce(function(obj, curr) {
        var name = util.uncapitalize(curr.name);
        obj[name] = zeroValue(curr.type);
        return obj;
      }, {});
    default:
      throw new TypeError('Unknown kind ' + t.kind);
  }
}

/**
 * Constructs an error for the value, type, and custom message.
 * @param {*} value The value.
 * @param {module:vanadium.vdl.Type} type The type.
 * @param {string} message The custom error message.
 * @return {Error} The constructed error.
 * @private
 */
function makeError(value, type, message) {
  return new TypeError('Value: ' + stringify(value) + ', Type: ' +
    type.toString() + ' - ' + message);
}

/**
 * Examines the given type and canonicalizes it. If the type is not valid for
 * its kind, then an error is thrown.
 * @param {module:vanadium.vdl.Type} t The type to be canonicalized.
 * @return {module:vanadium.vdl.Type} The canonicalized type.
 * @throws {Error} If the type is invalid.
 * @private
 */
function canonicalizeTypeExternal(t) {
  return canonicalizeType(t, new Map());
}

/**
 * Helper function for canonicalizeTypeExternal.
 * Keeps track of a Map of old references to new references. This helps clone
 * cycles and preserve shared references.
 * For unseen types, canonicalizeType calls canonicalize with a per-kind struct
 * representation of TypeObject.
 * @private
 */
function canonicalizeType(type, seen) {
  if (type === undefined) {
    // We whitelist undefined and return types.ANY. This check matches
    // canonicalizeValue's undefined => zeroValue(type).
    return zeroValue(types.TYPEOBJECT);
  } else {
    var cached = getFromSeenCache(seen, type, types.TYPEOBJECT);
    if (cached !== undefined) {
      return cached;
    }
  }

  if (!type.hasOwnProperty('kind')) {
    throw new TypeError('kind not specified');
  }
  if (typeof type.kind !== 'string') {
    throw new TypeError('kind expected to be a number. Got ' + type.kind);
  }

  // The Type for each kind has its own Type Object.
  // Verify deeply that the given type is in the correct form.
  var typeOfType = typeObjectFromKind(type.kind);

  // If the type has a field that is not relevant to its kind, then throw.
  Object.keys(type).forEach(function(key) {
    var upperKey = util.capitalize(key);

    var hasMatch = typeOfType.fields.some(function fieldMatch(field) {
      return field.name === upperKey;
    });
    if (!hasMatch) {
      throw new TypeError('Type has unexpected field ' + key);
    }
  });

  // Call canonicalize with this typeOfType. Even though typeOfType is a Struct,
  // behind the scenes, canonType will be a TypeObject.
  var canonType = canonicalize(type, typeOfType, typeOfType, false, seen, false,
    false);

  // Certain types may not be named.
  if (type.kind === kind.ANY || type.kind === kind.TYPEOBJECT) {
    if (canonType.name !== '') {
      throw makeError(
        canonType,
        typeOfType,
       'Any and TypeObject should be unnamed types');
    }
  }


  // Union needs at least 1 field.
  if (type.kind === kind.UNION && canonType.fields.length <= 0) {
    throw makeError(canonType, typeOfType, 'union needs >=1 field');
  }

  return canonType;
}

// Copy the unexported struct fields from the value to the copy.
// Do not copy _type and _wrappedType since they would block the prototype.
// TODO(alexfandrianto): Only used in Struct and Union. Do we need it elsewhere?
function copyUnexported(value, copy) {
  Object.keys(value).filter(function(key) {
    return !util.isExportedStructField(key) && key !== '_type' &&
      key !== '_wrappedType';
  }).forEach(function(key) {
    copy[key] = value[key];
  });
}

// Convert the given object into a Set.
function objectToSet(o) {
  var keys = Object.keys(o).filter(util.isExportedStructField);
  return keys.reduce(function(m, key) {
    m.add(util.capitalize(key));
    return m;
  }, new Set());
}

// Convert the given object into a Map.
function objectToMap(o) {
  var keys = Object.keys(o).filter(util.isExportedStructField);
  return keys.reduce(function(m, key) {
    m.set(util.capitalize(key), o[key]);
    return m;
  }, new Map());
}

// Convert a Set to a Map.
function setToMap(s) {
  var m = new Map();
  s.forEach(function(k) {
    m.set(k, true);
  });
  return m;
}

// Convert a Map to a Set.
function mapToSet(m, t) {
  var s = new Set();
  m.forEach(function(v, k) {
    // Is the value true? Since it may be a wrapped bool, unwrap it.
    if (TypeUtil.unwrap(v) === true) {
      s.add(k);
    } else if (TypeUtil.unwrap(v) !== false) {
      throw makeError(m, t, 'this Map value cannot convert to Set');
    }
  });
  return s;
}

/**
 * Creates an empty object with the correct Constructor and prototype chain.
 * @param {type} type The proposed type whose constructor is needed.
 * @param {v} value The value that is passed in.  If v is a native type,
 * its constructor is used instead of looking up in the registry.
 * @return {object} The empty object with correct type.
 * @private
 */
function getObjectWithType(t, v) {
  // Get the proper constructor from the Registry.
  registry = registry || require('./registry.js');
  var Constructor = registry.lookupOrCreateConstructor(t);

  if (v && nativeTypeRegistry.hasNativeType(t)) {
    Constructor = v.constructor;
  }

  // Then make an empty object with that constructor.
  var obj = Object.create(Constructor.prototype);
  Object.defineProperty(obj, 'constructor', { value: Constructor });

  return obj;
}

/**
 * Adds the new reference into the cache.
 * @param {object} seen Cache of old to new refs by type.
 * @param {object} oldRef The old reference.
 * @param {module:vanadium.vdl.Type} type The type the new reference is being
 * cached under.
 * @param {object} newRef The new reference.
 * @private
 */
function insertIntoSeenCache(seen, oldRef, type, newRef) {
  if (!seen.has(oldRef)) {
    seen.set(oldRef, new Map());
  }
  seen.get(oldRef).set(type, newRef);
}

/**
 * Returns a cached value from the seen cache.
 * If there is no such value, the function returns undefined.
 * @param {object} seen Cache of old to new refs by type.
 * @param {object} oldRef The old reference.
 * @param {module:vanadium.vdl.Type} type The type the new reference is being
 * cached under.
 * @return {object | undefined} The cached value or undefined, if not present.
 * @private
 */
function getFromSeenCache(seen, oldRef, type) {
  if (seen.has(oldRef) && seen.get(oldRef).has(type)) {
    return seen.get(oldRef).get(type);
  }
  return;
}

/**
 * Recursively unwraps v to drop excess ANY. Guesses the type, after.
 * Ex: null => { unwrappedValue: undefined, guessedType: types.ANY }
 * Ex: { val: null, of type ANY } =>
 *     { unwrappedValue: undefined, guessedType: types.ANY }
 * Ex: ANY in ANY with null =>
 *     { unwrappedValue: undefined, guessedType: types.ANY }
 * Ex: wrapped primitive =>
       { unwrappedValue: primitive, guessedType: typeOfPrimitiveWrapper }
 * Ex: nativeVal => { unwrappedValue: nativeVal, guessedType: types.JSVALUE }
 * @param{*} v The value which may have nested ANY
 * @return{object} Object with guessedType => type and unwrappedValue => value
 * @private
 */
function unwrapAndGuessType(v) {
  if (v === null || v === undefined) {
    return {
      unwrappedValue: undefined,
      guessedType: types.ANY
    };
  }
  var t = guessType(v);
  if (t.kind !== kind.ANY) {
    return {
      unwrappedValue: v,
      guessedType: t
    };
  }
  return unwrapAndGuessType(TypeUtil.unwrap(v));
}

/**
 * Finds the correct struct/union field type given a field name.
 * We rely on type compatibility to ensure that only Struct has leeway.
 * Maps use their elem as the field type, while Sets use types.BOOL.
 * @private
 */
function lookupFieldType(t, fieldName) {
  if (!t) {
    return undefined;
  }

  // Maps, Sets, Union, and Structs can have a field type by name.
  switch(t.kind) {
    case kind.MAP:
      return t.elem;
    case kind.SET:
      return types.BOOL;
    case kind.STRUCT:
    case kind.UNION:
      for (var i = 0; i < t.fields.length; i++) {
        if (t.fields[i].name === fieldName) {
          return t.fields[i].type;
        }
      }
  }
  return undefined;
}

/**
 * Helper function to create a BigInt from a native number.
 *
 * Since this contains a try/catch, it cannot be optimized and thus should not
 * be in-lined in a larger function.
 * @private
 */
function bigIntFromNativeNumber(v, t) {
  try {
    return BigInt.fromNativeNumber(v);
  } catch(e) {
    throw makeError(v, t, e);
  }
}

/**
 * Helper function to convert from a BigInt to a native number.
 *
 * Since this contains a try/catch, it cannot be optimized and thus should not
 * be in-lined in a larger function.
 * @private
 */
function bigIntToNativeNumber(v, t) {
  try {
    return v.toNativeNumber();
  } catch(e) {
    throw makeError(v, t, e);
  }
}

// Assumes that v is intended to be a numerical representation.
// Only use this for numerical kinds.
function assertRealNumber(v, t) {
  if ((isComplex(v)) && v.imag !== 0) {
    throw makeError(v, t, 'value is not purely real');
  }
}

// Assumptions made; real number
// Only use this for the numerical kinds.
function assertNonNegativeNumber(v, t) {
  switch(t.kind) {
    case kind.BYTE:
    case kind.UINT16:
    case kind.UINT32:
    case kind.UINT64:
      var isNegative = (v < 0 || ((v instanceof BigInt) && v.getSign() < 0) ||
        ((isComplex(v)) && v.real < 0));
      if (isNegative) {
        throw makeError(v, t, 'value cannot be negative');
      }
  }
}

// Assumptions made; real number
// Only use this for the numerical kinds.
// Assumes that the value given is a real number.
function assertInteger(v, t) {
  switch(t.kind) {
    case kind.BYTE:
    case kind.UINT16:
    case kind.UINT32:
    case kind.UINT64:
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
    case kind.INT64:
      var isInt;
      if (v instanceof BigInt) {
        isInt = true;
      } else if (isComplex(v)) {
        isInt = (Math.round(v.real) === v.real);
      } else {
        isInt = (Math.round(v) === v);
      }
      if (!isInt) {
        throw makeError(v, t, 'value cannot be a non-integer');
      }
  }
}

// Assumptions made; num is a number
function assertBounds(v, t, num) {
  var top = overflow.getMax(t.kind);
  var bot = overflow.getMin(t.kind);
  if (num > top) {
    throw makeError(v, t, num + ' is too large: max ' + top);
  } else if (num < bot) {
    throw makeError(v, t, num + ' is too small: min ' + bot);
  }
}

// Assumptions made; real integer
// Only use this for the small number kinds.
// TODO(alexfandrianto): We don't distinguish between float32 and float64 yet.
function convertToNativeNumber(v, t) {
  var num = v;
  if (v instanceof BigInt) {
    num = bigIntToNativeNumber(v, t);
  } else if (isComplex(v)) {
    num = v.real;
  }
  assertBounds(v, t, num);
  return num;
}

// Assumptions made; real integer
// Only use this for the UINT64 and INT64 kinds.
function convertToBigIntNumber(v, t) {
  if (v instanceof BigInt) {
    if (v.getUintBytes().length > 8) {
      throw makeError(v, t, 'BigInt has too many bytes');
    }
    return v;
  }
  if (isComplex(v)) {
    return bigIntFromNativeNumber(v.real, t);
  }
  return bigIntFromNativeNumber(v, t);
}

// Assumptions made; number
// Only use this for the Complex64 and Complex128 kinds.
function convertToComplexNumber(v, t) {
  if (v instanceof BigInt) {
    var num = bigIntToNativeNumber(v, t);
    assertBounds(v, t, num);
    return new Complex(num, 0);
  }
  if (isComplex(v)) {
    assertBounds(v, t, v.real);
    assertBounds(v, t, v.imag);
    return new Complex(v.real, v.imag);
  }
  assertBounds(v, t, v);
  return new Complex(v, 0);
}

// Converts a Uint8Array to a string. Converts in chunks to avoid any issues
// with maximum stack call size.
function uint8ArrayToString(arr) {
  var SIZE = 0x8000; // Arbitrary; avoids exceeding max call stack size.
  var chunks = [];
  for (var i = 0; i < arr.length; i += SIZE) {
    chunks.push(String.fromCharCode.apply(null, arr.subarray(i, i+SIZE)));
  }
  return chunks.join('');
}

// Converts a string to a Uint8Array.
// The array may have a length longer than the string.
function uint8ArrayFromString(str, neededLen) {
  var arr = new Uint8Array(neededLen);
  for (var i = 0; i < str.length; i++) {
    arr[i] = str.charCodeAt(i);
  }
  return arr;
}

// True if the value given can be treated like a Complex number.
function isComplex(v) {
  return v && (typeof v === 'object') && (typeof v.real === 'number') &&
    (typeof v.imag === 'number');
}

},{"./big-int.js":124,"./complex.js":127,"./es6-shim":131,"./guess-type.js":132,"./js-value-convert.js":135,"./kind.js":136,"./native-type-registry":137,"./overflow.js":138,"./registry.js":140,"./stringify.js":141,"./type-compatible.js":142,"./type-object-from-kind.js":143,"./type-util.js":144,"./type.js":145,"./types.js":146,"./util.js":147}],127:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview A type for complex numbers.
 * @private
 */

module.exports = Complex;

/**
 * @summary Represents a complex number.
 * @constructor
 * @memberof module:vanadium.vdl
 * @param {number} real The real part of the number.
 * @param {number} imag The imaginary part of the number.
 */
function Complex(real, imag) {
  this.real = real || 0;
  this.imag = imag || 0;
}

/**
 * @returns {string} The string format of this complex number.
 */
Complex.prototype.toString = function() {
  if (this.imag === 0) {
    return this.real + '';
  }
  if (this.real === 0) {
    return this.imag + 'i';
  }
  var sign = this.imag < 0 ? '-' : '+';
  var imag = Math.abs(this.imag);
  if (imag === 1) {
    imag = '';
  }
  return this.real + ' ' + sign + ' ' + imag + 'i';
};

/**
 * Adds a complex number to this complex number.
 * @param {module:vanadium.vdl.Complex} c The complex number to add to this
 * complex number.
 * @returns {module:vanadium.vdl.Complex} This complex number plus the argument
 * complex number.
 */
Complex.prototype.add = function(c){
  return new Complex(this.real + c.real,
                     this.imag + c.imag);

};

/**
 * Subtracts a complex number from this number.
 * @param {module:vanadium.vdl.Complex} c The complex number to subtract from
 * this complex number.
 * @returns {module:vanadium.vdl.Complex} This complex number minus the
 * argument complex number.
 */
Complex.prototype.subtract = function(c) {
  return new Complex(this.real - c.real,
                     this.imag - c.imag);
};

/**
 * Multiply a complex number with this number.
 * @param {module:vanadium.vdl.Complex} c The compler number to multiply this
 * complex number with.
 * @returns {module:vanadium.vdl.Complex} This complex number times the
 * argument complex number.
 */
Complex.prototype.multiply = function(c) {
  var real = this.real * c.real -
    this.imag * c.imag;
  var imag = this.real * c.imag +
    c.real * this.imag;
  return new Complex(real, imag);
};

/**
 * Divide this complex number by another complex number.
 * @param {module:vanadium.vdl.Complex} c The complex number to divide this
 * complex number by.
 * @returns {module:vanadium.vdl.Complex} This complex number divided by the
 * argument complex number.
 */
Complex.prototype.divide = function(c) {
  var num = this.multiply(new Complex(c.real, -c.imag));
  var denom = c.real * c.real + c.imag * c.imag;
  num.real = num.real / denom;
  num.imag = num.imag / denom;
  return num;
};

},{}],128:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Defines a function that creates a constructor for the specified type.

var kind = require('./kind.js');
var canonicalize = require('./canonicalize.js');

// TODO(bprosnitz) Test generated constructor pass validation logic.

// TODO(bprosnitz) This constructor (and others) are problematic with cycles
// (need to update all references). Should we change this?

// Create a constructor
// @param {Type} type The type to create a constructor for.
// (visible during debugging).
module.exports = function createConstructor(type) {
  var constructor;
  switch (type.kind) {
    case kind.OPTIONAL:
    case kind.ANY:
    case kind.BOOL:
    case kind.BYTE:
    case kind.UINT16:
    case kind.UINT32:
    case kind.UINT64:
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
    case kind.INT64:
    case kind.FLOAT32:
    case kind.FLOAT64:
    case kind.COMPLEX64:
    case kind.COMPLEX128:
    case kind.STRING:
    case kind.ENUM:
    case kind.TYPEOBJECT:
    // TODO(bprosnitz) Should we treat collections differently?
    case kind.SET:
    case kind.MAP:
    case kind.ARRAY:
    case kind.LIST:
      constructor = createWrappedConstructor();
      break;
    case kind.UNION:
    case kind.STRUCT:
      constructor = createStructConstructor();
      break;
    default:
      throw new Error('Cannot create constructor for type of kind: ' +
        type.kind);
  }

  constructor.prototype._type = type;
  if (type.hasOwnProperty('name')) {
    // if displayName is set, the browser will show it as the
    // function name when debugging.
    // Note: full support for this in chrome is in progress.
    constructor.displayName = 'TypeConstructor[' + type.name + ']';
  } else {
    constructor.displayName = 'TypeConstructor';
  }
  return constructor;
};

function createStructConstructor() {
  /**
   * StructConstructor constructs struct-like values like Union and Struct.
   * Any data given to this constructor will be canonicalized.
   * Note: If val is omitted, then the 'zero-value' will be generated.
   * @private
   * @param{object=} val The value whose fields will be copied into this object.
   * @param{boolean=} deepWrap Whether to deepWrap or not. Defaults to false.
   */
  return function StructConstructor(val, deepWrap) {
    deepWrap = deepWrap || false;
    if (!(this instanceof StructConstructor)) {
      return new StructConstructor(val, deepWrap);
    }
    // Canonicalize the given value and copy the resultant fields.
    var cpy = deepWrap ?
      canonicalize.fill(val, this._type) :
      canonicalize.construct(val, this._type);

    for (var fieldName in cpy) {
      if (!cpy.hasOwnProperty(fieldName)) {
        continue;
      }
      this[fieldName] = cpy[fieldName];
    }
  };
}

function createWrappedConstructor() {
  /**
   * WrappedConstructor constructs an object with a 'val' field.
   * Any data given to this constructor will be canonicalized.
   * Note: If val is omitted, then the 'zero-value' will be generated.
   * @private
   * @param{object=} val The value, which will be assigned to 'val'.
   * @param{boolean=} deepWrap Whether to deepWrap or not. Defaults to false.
   */
  var constructor = function WrappedConstructor(val, deepWrap) {
    deepWrap = deepWrap || false;
    if (!(this instanceof WrappedConstructor)) {
      return new WrappedConstructor(val, deepWrap);
    }
    var ideal = deepWrap ?
      canonicalize.fill(val, this._type) :
      canonicalize.reduce(val, this._type);
    this.val = ideal.val;
  };
  constructor.prototype._wrappedType = true;
  constructor.prototype.toString = function() {
    return '' + this.val;
  };
  return constructor;
}

},{"./canonicalize.js":126,"./kind.js":136}],129:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview A method to create an array of interface signatures for a
 * service based on the descriptions passed in.
 * @private
 */
module.exports = createSignature;

var stringify = require('./stringify');
var capitalize = require('./util').capitalize;
var Interface = require('./interface');

function sigsHaveMethod(sigs, method) {
  return sigs.some(function(sig) {
    return sig.methods.some(function(elem) {
      return elem.name === method;
    });
  });
}

function createSignature(service, descs) {
  if (!Array.isArray(descs)) {
    if (typeof descs !== 'object') {
      descs = [];
    } else {
      descs = [descs];
    }
  }

  var sigs = descs.map(function(desc) {
    return new Interface(service, desc);
  });
  // Find any methods that are in service that are not in any of the
  // signatures generated and then generate a signature that contains
  // those methods.
  var leftOverSig = {
    methods: []
  };
  for (var methodName in service) {
    if (typeof service[methodName] === 'function') {
      var name = capitalize(methodName);
      if (!sigsHaveMethod(sigs, name)) {
        leftOverSig.methods.push({ name: name });
      }
    }
  }

  // TODO(bjornick): How terrible is it to create this leftover signature if the
  // user provided a description and thought (incorrectly) that it was complete?
  if (leftOverSig.methods.length > 0) {
    sigs.push(new Interface(service, leftOverSig));
  }

  checkForConflicts(sigs);
  return sigs;
}

// Looks through all the Interface signatures and makes sure that any duplicate
// methods have the same signature.  Throws if there are any conflicts.
function checkForConflicts(sigs) {
  // Keep track of the methods sigs seen so far.  The key is the method name.
  // the value is the an object containing the interface name under the key
  // 'interfaceName' and the method signature under the key 'sig'.
  var methodsSeen = {};
  sigs.forEach(function(sig) {
    sig.methods.forEach(function(method) {
      if (methodsSeen[method.name]) {
        var seenMethod = methodsSeen[method.name].sig;
        var iname = methodsSeen[method.name].interfaceName;
        if (stringify(method) !== stringify(seenMethod)) {
          throw new Error('Method ' + method.name + ' has conflicting ' +
                          'signatures in ' + iname + ' and ' + sig.name);
        }
      } else {
        methodsSeen[method.name] = {
          sig: method,
          interfaceName: sig.name
        };
      }
    });
  });
}

},{"./interface":134,"./stringify":141,"./util":147}],130:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var errorMap = require('./../runtime/error-map');
var VanadiumError = require('./../verror/vanadium-error');
var defaultLanguage = require('./../runtime/default-language');
var defaultCatalog = require('./../runtime/default-catalog');
var unwrap = require('./type-util').unwrap;
var verror = require('../gen-vdl/v.io/v23/verror');
var canonicalize = require('./canonicalize');
var registry = require('./native-type-registry');
var types = require('./types');
var defaultLanguage = require('../runtime/default-language');

module.exports = {
  fromWireValue: fromWireValue,
  fromNativeValue: fromNativeValue,
};

// VanadiumErrors already have the right type description.  We registered Error
// in case anyone tries to pass a non-vanadium error as an argument to a
// function.
registry.registerFromNativeValue(Error, fromNativeValue, types.ERROR.elem);
// We register both the optional and the concrete type for the error depending
// on what gets sent on the wire.
registry.registerFromWireValue(types.ERROR.elem, fromWireValue);

var unknown = (new verror.UnknownError(null));

/**
 * Converts from a verror standard struct which comes from wspr to JavaScript
 * Error object ensuring message and name are set properly
 * @private
 * @param {_standard} verr verror standard struct
 * @return {Error} JavaScript error object
 */
function fromWireValue(verr) {
  // We have to unwrap verr, because it could either be of type types.ERROR
  // or types.ERROR.elem The first type is an optional version of the
  // second type.
  verr = unwrap(verr);
  if (verr instanceof VanadiumError) {
    return verr.clone();
  }

  if (!verr) {
    return null;
  }
  var id = verr.id;
  var retry = verr.retryCode;
  var msg = verr.msg;
  verr.paramList = verr.paramList || [];

  var Ctor = errorMap[id] || VanadiumError;
  var err = Object.create(Ctor.prototype);
  Object.defineProperty(err, 'constructor', { value: Ctor });
  err.id = id;
  err.retryCode = retry;
  err.msg = msg;
  err.paramList = verr.paramList || [];
  // TODO(bjornick): We should plumb the context into the decoder so we can
  // get the correct langid.
  err._langId = defaultLanguage;
  Object.defineProperty(err, 'message', { value: msg });

  if (typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(err, VanadiumError);
  } else {
    Object.defineProperty(err, 'stack', { value: (new Error()).stack });
  }

  return err;
}

/**
 * Converts from a JavaScript error object to verror standard struct which
 * wspr expects as error format.
 * @private
 * @param {Error} err JavaScript error object
 * @param {string} appName name of the app
 * @param {string} operation operation name.
 * @return {_standard} verror standard struct
 */
function fromNativeValue(err, appName, operation) {
  var paramList = [];
  if (err instanceof VanadiumError) {
    var res = err.clone();
    // We need to call fill on the paramList.  We know what
    // the expected for the defined parameters are so, we should
    // use that rather than JSValue when encoding them.
    paramList = unwrap(res.paramList);
    if (paramList.length > 0) {
      paramList[0] = canonicalize.fill(
        canonicalize.reduce(paramList[0], types.STRING),
        types.ANY);
    }
    if (paramList.length > 1) {
      paramList[1] = canonicalize.fill(
        canonicalize.reduce(paramList[1], types.STRING),
        types.ANY);
    }

    var argTypes = res._argTypes || [];
    // The first two arguments, if they exist are strings
    for (var i = 2; i < paramList.length; i++) {
      var argType = argTypes[i-2];

      // Do our best to guess the type. This avoids revealing JSValue in our
      // errors when sending native value parameters. Note: This is very hacky.
      // TODO(alexfandrianto): We need to do this because other languages will
      // print out the JSValue when they get it as an ANY. The resulting errors
      // are quite unreadable. If we guess string, number, or bool, then at
      // least they will receive something they know how to print. The cost to
      // us is that these parameters will become wrapped upon decode.
      // Issue: https://github.com/veyron/release-issues/issues/1560
      if (!argType) {
        if (typeof paramList[i] === 'string') {
          argType = types.STRING;
        } else if (typeof paramList[i] === 'boolean') {
          argType = types.BOOL;
        } else if (typeof paramList[i] === 'number') {
          argType = types.FLOAT64;
        }
      }

      // If the arg has a type, canonicalize.
      if (argType) {
        paramList[i] = canonicalize.fill(
          canonicalize.reduce(paramList[i], argType),
          types.ANY
        );
      }
    }
    return res;
  }

  if (!err) {
    return null;
  }
  var message = '';

  var errID = err.id || unknown.id;
  var errRetryCode = err.retryCode || unknown.retryCode;

  var errProps = {};
  if (err instanceof Error) {
    Object.getOwnPropertyNames(err).forEach(function(propName) {
      if (propName === 'message') {
        // Skip 'message' field since we set that ourselves to be enumerable.
        return;
      }
      errProps[propName] = Object.getOwnPropertyDescriptor(err, propName);
      // Set the property to non-enumerable.
      errProps[propName].enumerable = false;
    });

    message = err.message;

    paramList = ['app', 'call', message];
  } else if (err !== undefined && err !== null) {
    paramList = unwrap(err.paramList) || [appName, operation, err + ''];
    message = err.message || err.msg || defaultCatalog.format(
      defaultLanguage, errID, paramList);
  }

  if (!paramList[0] && appName) {
    paramList[0] = appName;
  }

  if (!paramList[1] && operation) {
    paramList[1] = operation;
  }
  // Make a copy of paramList
  var args = paramList.slice(0);
  // Add a null context to the front of the args.
  args.unshift(null);

  // Pick the correct Error Constructor. If there isn't one, use Unknown.
  var EConstructor = errorMap[errID] || verror.UnknownError;
  var e = new EConstructor(args);

  // Add properties from original error.
  Object.defineProperties(e, errProps);

  // Add verror fields.
  e.id = errID;
  e.retryCode = errRetryCode;
  e.resetArgs.apply(e, paramList);

  // Add message and msg so that they will be enumerable.
  e.message = message;
  e.msg = message;

  return e;
}

},{"../gen-vdl/v.io/v23/verror":57,"../runtime/default-language":101,"./../runtime/default-catalog":100,"./../runtime/default-language":101,"./../runtime/error-map":102,"./../verror/vanadium-error":153,"./canonicalize":126,"./native-type-registry":137,"./type-util":144,"./types":146}],131:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

if (typeof Map === 'undefined' || typeof Set === 'undefined') {
  // Make this require an expression, so browserify won't include it.
  require('es6-' + 'shim');
}

},{}],132:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Guesses the type of the given value.
 * Values can be either normal JavaScript value, or have type information
 * associated with them.
 * @private
 */

var types = require('./types.js');
var typeUtil = require('./type-util.js');
require('./es6-shim');
var nativeTypeRegistry = require('./native-type-registry');

module.exports = guessType;

/**
 * Guess the type of a value based on its contents. If _type is not present
 * this returns types.JSValue.
 * @private
 * @param {*} val The value.
 * @return {module:vanadium.vdl.Type} The guessed type for val.
 */
function guessType(val) {
  if (typeUtil.isTyped(val)) {
    return val._type;
  }

  var nativeType = nativeTypeRegistry.lookupNativeToType(val);
  if (nativeType) {
    return nativeType;
  }

  return types.JSVALUE;
}

},{"./es6-shim":131,"./native-type-registry":137,"./type-util.js":144,"./types.js":146}],133:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @summary Namespace vdl defines the Vanadium Definition Language type and
 * value system.
 *
 * @description
 * <p>Namespace vdl defines the Vanadium Definition Language type and value
 * system.</p>
 *
 * <p>VDL is an interface definition language designed to enable interoperation
 * between clients and servers executing in heterogeneous environments.</p>
 *
 * For example, VDL enables a frontend written in Javascript running on a phone
 * to communicate with a backend written in Go running on a server.</p>
 *
 * <p>VDL is compiled into an intermediate representation that is used to
 * generate code in each target environment.</p>
 *
 * <p>The concepts in VDL are similar to the concepts used in general-purpose
 * languages to specify interfaces and communication protocols.</p>
 *
 * @namespace
 * @name vdl
 * @memberof module:vanadium
 */
module.exports = {
  kind: require('./kind'),
  types: require('./types'),
  BigInt: require('./big-int'),
  canonicalize: require('./canonicalize'),
  Complex: require('./complex'),
  /**
   * Type registry that contains a mapping of vdl types
   * to constructors
   * @memberof module:vanadium.vdl
   */
  registry: require('./registry'),
  Type: require('./type'),
};

/**
 * @namespace
 * @name signature
 * @summary Namespace of types representing interface and method signatures.
 * @description Namespace of types representing interface and method signatures.
 * @memberof module:vanadium.vdl
 */
module.exports.signature = require('../gen-vdl/v.io/v23/vdlroot/signature');
/**
 * @namespace
 * @name time
 * @summary Namespace of types representing absolute and relative times.
 * @description Namespace of types representing absolute and relative times.
 * @memberof module:vanadium.vdl
 */
module.exports.time = require('../gen-vdl/v.io/v23/vdlroot/time');

require('./es6-shim.js'); // If necessary, adds ES6 Map, Set, etc.

},{"../gen-vdl/v.io/v23/vdlroot/signature":55,"../gen-vdl/v.io/v23/vdlroot/time":56,"./big-int":124,"./canonicalize":126,"./complex":127,"./es6-shim.js":131,"./kind":136,"./registry":140,"./type":145,"./types":146}],134:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Generator of service interface from JavaScript object.
 * This interface can optionally include additional information in a
 * descriptor object.
 * @private
 */

module.exports = Interface;

var types = require('./types');
var vdlsig = require('../gen-vdl/v.io/v23/vdlroot/signature');
var ReflectInterface = require('./reflect-interface');
var vlog = require('../lib/vlog');

// Each argument type is JSValue.
// This can be overriden by specifying types in the description.
var defaultArgType = types.JSVALUE;

// Default to returning a single out arg.
var defaultOutArgs = [
  {
    type: defaultArgType
  }
];

// Streaming default arg description.
var defaultStreamingArg = {
    type: defaultArgType
};

function Interface(service, desc) {
  if (!(this instanceof Interface)) {
    return new Interface(service, desc);
  }
  if (typeof desc !== 'object') {
    desc = {};
  }

  vdlsig.Interface.call(this);

  var reflectInt = new ReflectInterface(service);

  copyIfSet(this, desc, ['name', 'pkgPath', 'doc', 'embeds']);

  this.methods = [];
  var methods = this.methods;
  reflectInt.methods.forEach(function(reflectMethod) {
    var thisMethod = {
      name: reflectMethod.name,
      inArgs: reflectMethod.inArgs,
      outArgs: defaultOutArgs
    };

    // Assign default arg type to each inArg.
    if (reflectMethod.inArgs) {
      thisMethod.inArgs.forEach(function(inArg) {
        inArg.type = defaultArgType;
      });
    }

    // Assign default streaming args.
    if (reflectMethod.streaming) {
      thisMethod.inStream = defaultStreamingArg;
      thisMethod.outStream = defaultStreamingArg;
    }

    if (desc.hasOwnProperty('methods')) {
      var foundMethods = desc.methods.filter(function(meth) {
        return meth.name === reflectMethod.name;
      });
      if (foundMethods.length === 0) {
        return;
      }
      if (foundMethods.length !== 1) {
        throw new Error('Duplicate method description for method ' +
                        reflectMethod.name);
      }
      var descMethod = foundMethods[0];

      if (descMethod.hasOwnProperty('inArgs')) {
        if (!Array.isArray(descMethod.inArgs)) {
          throw new Error('inArgs expected to be an array');
        }

        var thisArgs = thisMethod.inArgs;
        var descArgs = descMethod.inArgs;

        if (thisArgs.length === descArgs.length) {
          // Copy arg details.
          for (var argix = 0; argix < thisArgs.length; argix++) {
            copyIfSet(thisArgs[argix], descArgs[argix],
                      ['doc', 'type', 'name']);
          }
        } else {
          // TODO(bprosnitz) What about methods that use the
          // arguments variable and don't declare arguments.
          // TODO(bprosnitz) How would this look if we support vararg
          // in the future?
          vlog.logger.warn('Args of method ' + thisMethod.name + ' don\'t ' +
                           'match descriptor');
        }
      }

      copyIfSet(thisMethod, descMethod, ['doc', 'outArgs', 'tags']);
      if (reflectMethod.streaming === true) {
        copyIfSet(thisMethod, descMethod, ['inStream', 'outStream']);
      }

      // Only add the method if it is in the desc passed in.
      methods.push(new vdlsig.Method(thisMethod));
    }
  });
}

Interface.prototype = new vdlsig.Interface();

function copyIfSet(dst, src, fields) {
  for (var i = 0; i < fields.length; i++) {
      var fieldName = fields[i];
      if (src.hasOwnProperty(fieldName)) {
          dst[fieldName] = src[fieldName];
      }
  }
}

},{"../gen-vdl/v.io/v23/vdlroot/signature":55,"../lib/vlog":79,"./reflect-interface":139,"./types":146}],135:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Converts native JavaScript values to and from JSValue
 * The outputted JSValues are not necessarily canonical, nor in the same form.
 * For example, a Set turns into a list of its keys, and Map and Object become
 * a list of key-value pairs.
 * This file should not be exported at the top-level; it is meant to be used by
 * canonicalize only. It is unit-tested separately.
 * @private
 */

var typeUtil = require('./type-util.js');
var types = require('./types.js');
var util = require('./util.js');
require('./es6-shim');

module.exports = {
  fromNative: convertFromNative,
  toNative: convertToNative
};

// There is only a single JSValueConstructor.
// In order to avoid any cyclical dependencies, this constructor is obtained
// from the registry with delayed dependency injection.
// TODO(alexfandrianto): Can this be obtained from a VDL file that defines the
// JSValue? A potential issue is that VDL-generated files require 'vom', and
// this is the 'vom' library.
var JSValueConstructor = null;
function getJSValueConstructor() {
  if (JSValueConstructor === null) {
    var Registry = require('./registry.js');
    JSValueConstructor = Registry.lookupOrCreateConstructor(types.JSVALUE);
  }
  return JSValueConstructor;
}
/**
 * Convert the given raw value into the proper JSValue form.
 * Note: Skips typed values, so it will not convert any native values there.
 * Excluding undefined, raw values satisfy the following equality:
 * convertToNative(convertFromNative(val)) === val
 * @private
 * @param {*} val The value to be molded into a JSValue.
 * @return {*} The JSValue.
 */
function convertFromNative(val) {
  // No need to convert if val is already a JSValue or typed object.
  // Note: In this case, val is NOT a new reference.
  if (typeUtil.isTyped(val)) {
    return val;
  }

  // Associate the JSValue prototype with the returned object.
  // Avoids using 'new JSValue(...)' because that would call canonicalize.
  var JSValue = getJSValueConstructor();
  var ret = Object.create(JSValue.prototype);

  if (val === undefined || val === null) {
    ret.null = {}; // must be the 'empty struct', but any value will do.
  } else if (typeof val === 'boolean') {
    ret.boolean = val;
  } else if (typeof val === 'number') {
    ret.number = val;
  } else if (typeof val === 'string') {
    ret.string = val;
  } else if (typeof val !== 'object') {
    // From here on, only objects can convert to JSValue.
    throw new TypeError('Cannot convert a ' + (typeof val) + ' to JSValue');
  } else if (val instanceof Uint8Array) {
    ret.bytes = new Uint8Array(val);
  } else if (Array.isArray(val)) {
    ret.list = val.map(function(elem) {
      return convertFromNative(elem);
    });
  } else if (val instanceof Set) {
    // Set: Return a []JSValue
    var keys = [];
    val.forEach(function(key) {
      keys.push(convertFromNative(key));
    });
    ret.set = keys;
  } else if (val instanceof Map) {
    // Map: Return []{key, value pairs}
    var keyVals = [];
    val.forEach(function(elem, key) {
      keyVals.push({
        'key': convertFromNative(key),
        'value': convertFromNative(elem)
      });
    });
    ret.map = keyVals;
  } else {
    // defaults to... Object: Return []{string key, value pairs}
    // Note: Ignores 'private' fields: keys that start with '_'
    ret.object = Object.keys(val).filter(util.isExportedStructField).map(
      function(key) {
        return {
          'key': key,
          'value': convertFromNative(val[key])
        };
      }
    );
  }
  return ret;
}

/**
 * Convert the given JSValue into the proper raw value.
 * Note: Skips conversion of non-JS values.
 * Excluding undefined, raw values satisfy the following equality:
 * convertToNative(convertFromNative(val)) === val
 * @private
 * @param{JSValue} jsval The JSValue to be restored into raw form.
 * @return The raw value
 */
function convertToNative(jsval) {
  // No need to convert if jsval lacks type or isn't of type JSValue.
  if (!typeUtil.isTyped(jsval) || !types.JSVALUE.equals(jsval._type)) {
    return jsval;
  }
  if (jsval === undefined) {
    return null;
  }

  // jsval is in the Union format. Extract its value, ignoring keys associated
  // with undefined values.
  var jsvalKey = util.getFirstDefinedPropertyKey(jsval);
  if (jsvalKey === undefined) {
    throw new Error('could not convert from JSValue. given: ' +
      JSON.stringify(jsval));
  }
  var jsvalElem = jsval[jsvalKey];
  return convertToNativeInternal(jsvalKey, jsvalElem);
}

// Based on the key and internal JSValue, return the raw value.
function convertToNativeInternal(jsvalKey, jsvalElem) {
  switch(jsvalKey) {
    case 'null':
      return null;
    case 'boolean':
    case 'number':
    case 'string':
    case 'bytes':
      return jsvalElem;
    case 'list':
      var list = new Array(jsvalElem.length);
      for (var i = 0; i < jsvalElem.length; i++) {
        list[i] = convertToNative(jsvalElem[i]);
      }
      return list;
    case 'set':
      var set = new Set();
      jsvalElem.forEach(function(j) {
        set.add(convertToNative(j));
      });
      return set;
    case 'map':
      var map = new Map();
      jsvalElem.forEach(function(j) {
        map.set(
          convertToNative(j.key),
          convertToNative(j.value)
        );
      });
      return map;
    case 'object':
      var object = {};
      jsvalElem.forEach(function(j) {
        object[j.key] = convertToNative(j.value);
      });
      return object;
    default:
      throw new Error('unknown JSValue key ' + jsvalKey + ' with value ' +
        jsvalElem);
  }
}

},{"./es6-shim":131,"./registry.js":140,"./type-util.js":144,"./types.js":146,"./util.js":147}],136:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview kind definitions.
 * @private
 */

/**
 * @summary Namespace of constants for VDL kinds.
 * @description Namespace of constants for VDL kinds.
 * @namespace
 * @memberof module:vanadium.vdl
 */
var kind = {
  // Nullable kinds
  /**
   * @type {string}
   * @const
   */
  ANY: 'any',
  /**
   * @type {string}
   * @const
   */
  OPTIONAL: 'optional',
  // Scalar kinds
  /**
   * @type {string}
   * @const
   */
  BOOL: 'bool',
  /**
   * @type {string}
   * @const
   */
  BYTE: 'byte',
  /**
   * @type {string}
   * @const
   */
  UINT16: 'uint16',
  /**
   * @type {string}
   * @const
   */
  UINT32: 'uint32',
  /**
   * @type {string}
   * @const
   */
  UINT64: 'uint64',
  /**
   * @type {string}
   * @const
   */
  INT8: 'int8',
  /**
   * @type {string}
   * @const
   */
  INT16: 'int16',
  /**
   * @type {string}
   * @const
   */
  INT32: 'int32',
  /**
   * @type {string}
   * @const
   */
  INT64: 'int64',
  /**
   * @type {string}
   * @const
   */
  FLOAT32: 'float32',
  /**
   * @type {string}
   * @const
   */
  FLOAT64: 'float64',
  /**
   * @type {string}
   * @const
   */
  COMPLEX64: 'complex64',
  /**
   * @type {string}
   * @const
   */
  COMPLEX128: 'complex128',
  /**
   * @type {string}
   * @const
   */
  STRING: 'string',
  /**
   * @type {string}
   * @const
   */
  ENUM: 'enum',
  /**
   * @type {string}
   * @const
   */
  TYPEOBJECT: 'typeobject',
  // Composite kinds
  /**
   * @type {string}
   * @const
   */
  ARRAY: 'array',
  /**
   * @type {string}
   * @const
   */
  LIST: 'list',
  /**
   * @type {string}
   * @const
   */
  SET: 'set',
  /**
   * @type {string}
   * @const
   */
  MAP: 'map',
  /**
   * @type {string}
   * @const
   */
  STRUCT: 'struct',
  /**
   * Union is like struct, but with only 1 field filled in.
   * @type {string}
   * @const
   */
  UNION: 'union',
};

module.exports = kind;

},{}],137:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

module.exports = {
  fromNativeValue: fromNativeValue,
  fromWireValue: fromWireValue,
  registerFromNativeValue: registerFromNativeValue,
  registerFromWireValue: registerFromWireValue,
  hasNativeType: hasNativeType,
  isNative: isNative,
  lookupNativeToType: lookupNativeToType
};

require('./es6-shim');

// A map from vdl type string to a function that produces
// a wire type from the vdl value.
var nativeToWire = {};

// A map from native constructor to vdl type string.
// Used to determine the type of a native value.
var nativeToType = new Map();

// A map from vdl type string to a function that produces
// a native type from the vdl value.
var wireToNative = {};

/**
 * Registers a converter that converts from wire type to native type.
 * @private
 * @param {Value} t The type to convert from
 * @param {function} f A function that takes in a wire type representation
 * and returns the native type for it.
 */
function registerFromWireValue(t, f) {
  wireToNative[t.toString()] = f;
}

/**
 * Registers a converter that converts from native type to wire type.
 * @private
 * @param {function} constructor The constructor for the native object.
 * @param {function} f A function that takes in a native object and returns
 * the wire type representation of it.
 * @param {Type} type The wiretype fo the native value.
 */
function registerFromNativeValue(constructor, f, t) {
  nativeToWire[t.toString()] = f;
  nativeToType.set(constructor, t);
}

/**
 * Converts v from native type to the wire type format.
 * @private
 * @param {function} v The value to convert
 * @returns {object} The wiretype respresentation of the object.  If
 * no conversion happened, v is returned.
 */
function fromNativeValue(t, v) {
  var transform = nativeToWire[t.toString()];
  if (transform) {
    return transform(v);
  }
  return v;
}

function lookupNativeToType(v) {
  var result = null;
  nativeToType.forEach(function(wire, native) {
    if (result === null && v instanceof native) {
      result = wire;
    }
  });
  return result;
}

/**
 * Converts v from wire type to native type.
 * @private
 * @param {Value} t The type of v
 * @param {function} v The value to convert
 * @returns {object} The native object that is equivalent to v.  If
 * no conversion happened, v is returned.
 */
function fromWireValue(t, v) {
  try {
    var transform = wireToNative[t.toString()];
    if (transform) {
      return transform(v);
    }
    return v;
  } catch (e) {
    throw e;
  }
}

/**
 * Returns whether this Type has a native converter registered
 * @private
 * @param {Value} t The type
 * @returns {boolean} True iff there is native converter for this type.
 */
function hasNativeType(t) {
  return !!wireToNative[t.toString()];
}

/**
 * Returns whether this value has a wiretype converter registered
 * @private
 * @param {*} v The object to check.
 * @returns {boolean} True iff there is wiretype converter for this
 * object.
 */
function isNative(v) {
  if (v === undefined || v === null) {
    return false;
  }
  return !!lookupNativeToType(v);
}

},{"./es6-shim":131}],138:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var kind = require('./kind.js');

module.exports = {
  getMax: getMax,
  getMin: getMin
};

function getMax(k) {
  switch(k) {
    case kind.BYTE:
      return 0xff;
    case kind.UINT16:
      return 0xffff;
    case kind.UINT32:
      return 0xffffffff;
    case kind.INT8:
      return 0x7f;
    case kind.INT16:
      return 0x7fff;
    case kind.INT32:
      return 0x7fffffff;
    case kind.FLOAT32:
    case kind.COMPLEX64:
      return 3.40282346638528859811704183484516925440e+38;
    case kind.FLOAT64:
    case kind.COMPLEX128:
      return Number.MAX_VALUE;
  }
}

function getMin(k) {
  switch(k) {
    case kind.BYTE:
      return 0;
    case kind.UINT16:
      return 0;
    case kind.UINT32:
      return 0;
    case kind.INT8:
      return -0x80;
    case kind.INT16:
      return -0x8000;
    case kind.INT32:
      return -0x80000000;
    case kind.FLOAT32:
    case kind.COMPLEX64:
      return -3.40282346638528859811704183484516925440e+38;
    case kind.FLOAT64:
    case kind.COMPLEX128:
      return -Number.MAX_VALUE;
  }
}

},{"./kind.js":136}],139:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Generator of typeless service interface from JavaScript object.
 * @private
 */

module.exports = ReflectInterface;

var ArgInspector = require('../lib/arg-inspector');
var isPublicMethod = require('../lib/service-reflection').isPublicMethod;
var vdlUtil = require('./util');
var format = require('format');

/**
  * Create an interface for a service by inspecting the service object.
  * @private
  * @param {Service} service The service.
  * @constructor
  */
function ReflectInterface(service) {
  if (!(this instanceof ReflectInterface)) {
    return new ReflectInterface(service);
  }

  var ifc = this;

  ifc.methods = [];

  // NOTE: service.hasOwnProperty(key) is intentionally omitted so that
  // methods defined on the prototype chain are mapped into the interface
  // correctly. This supports services defined using constructors:
  //
  //     function Service() {
  //
  //     }
  //
  //     Service.prototype.method = function() {
  //
  //     }
  //
  // TODO(jasoncampbell): At some point we should try to avoid inherited
  // properties so we don't unintentionally publish a service's internal
  // implementation where inheritance has been used (event emitters etc.).
  //
  // SEE: http://git.io/mi6jDg
  // SEE: veyron/release-issues#657
  for (var key in service) { // jshint ignore:line
    if (!isPublicMethod(key, service)) {
      continue;
    }

    var method = service[key];
    var methodSignature = {
      name: vdlUtil.capitalize(key),
      streaming: false
    };

    var argInspector = new ArgInspector(method);
    // Check whether the number of args reported by javascript (method.length)
    // and the number of args retrieved from fn.toString() are the same.
    // This usually differs if the method is a native method.
    if (argInspector.names.length !== method.length) {
      throw new Error('Function "' + key + '" can not be inspected. ' +
        'This is usually because it is a native method or bind is used.');
    }
    var message;
    if (!argInspector.hasContext()) {
      message = format('Service method "%s" is missing the required ' +
        '`context` object as the first argument in its definition. ' +
        'Args were: %s',
          key, argInspector.names);
      throw new Error(message);
    }

    if (!argInspector.hasCall()) {
      message = format('Service method "%s" is missing the required ' +
        '`serverCall` object as the second argument in its definition. ' +
        'Args were: %s',
          key, argInspector.names);
      var e = new Error(message);
      throw e;
    }

    methodSignature.inArgs = argInspector.filteredNames.map(function(name) {
      return { name: name };
    });

    methodSignature.streaming = argInspector.contains('$stream');

    // Add this method's signature to its service interface.
    ifc.methods.push(methodSignature);
  }

  // Sort all the method signatures by method name.
  ifc.methods.sort(function(methodSig, methodSig2) {
    if (methodSig.name === methodSig2.name) {
      return 0;
    }
    return methodSig.name < methodSig2.name ? -1 : 1;
  });
}

},{"../lib/arg-inspector":66,"../lib/service-reflection":75,"./util":147,"format":31}],140:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var createConstructor = require('./create-constructor.js');
var typeObjectFromKind = require('./type-object-from-kind.js');
var kind = require('./kind.js');
var Type = require('./type.js');
require('./es6-shim');

/**
 * @summary Maps types to corresponding constructors.
 *
 * @description
 * <p>Registered constructors convert a given value to a a vom-typed object.
 * There is no support for removing added constructors.</p>
 *
 * @constructor
 * @inner
 * @memberof module:vanadium.vdl
 */
function Registry() {
  this._builtinTypes = this._getBuiltinTypes();
  this._registeredTypes = {};
}

Registry.prototype._getBuiltinTypes = function() {
  var map = new Map();

  // Canonicalize uses structs to represent each kind of TypeObject. Thus, the
  // constructor for those structs should be Type.
  Object.keys(kind).forEach(function(key) {
    var k = kind[key];
    if (typeof k === 'string') {
      var typeOfType = typeObjectFromKind(k);
      map.set(typeOfType, Type);
    }
  });
  return map;
};

Registry.prototype._addConstructor = function(type, ctor) {
  if (!(type instanceof Type)) {
    type = new Type(type);
  }
  var str = type.toString();
  if (this._registeredTypes.hasOwnProperty(str)) {
    throw new Error(str + ' is already registered');
  }
  this._registeredTypes[str] = ctor;
};

Registry.prototype._lookupConstructor = function(type) {
  if (!(type instanceof Type)) {
    type = new Type(type);
  }
  // Special Case: Certain builtin types, matched via ===, use a specially
  // chosen constructor.
  if (this._builtinTypes.has(type)) {
    return this._builtinTypes.get(type);
  }

  var str = type.toString();
  if (this._registeredTypes.hasOwnProperty(str)) {
    return this._registeredTypes[str];
  }
  return null;
};

/**
 * Lookup a constructor. If it isn't found, then create a new one and register
 * it.
 * @param {module:vanadium.vdl.Type} type Type
 * @return {function} The constructor function for the type.
 */
Registry.prototype.lookupOrCreateConstructor = function(type) {
  if (!(type instanceof Type)) {
    type = new Type(type);
  }
  var lookupResult = this._lookupConstructor(type);
  if (lookupResult !== null) {
    return lookupResult;
  }

  var constructor = createConstructor(type);
  this._addConstructor(type, constructor);
  return constructor;
};

var globalRegistry = new Registry();
module.exports = globalRegistry;

},{"./create-constructor.js":128,"./es6-shim":131,"./kind.js":136,"./type-object-from-kind.js":143,"./type.js":145}],141:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Defines a stable stringifier that handles cycles.
 * @private
 */

module.exports = stableCircularStringify;

require('./es6-shim');

function stableCircularStringifyInternal(val, seen) {
  if (typeof val === 'number' || typeof val === 'boolean' ||
     val === undefined || val === null) {
    return '' + val;
  }
  if (typeof val === 'string') {
    return '"' + val.replace(/\"/, '\\"') + '"';
  }
  if (val instanceof Date) {
    return val.toString();
  }

  var i;
  if (seen.has(val)) {
    var ret = seen.get(val);
    if (ret.hasOwnProperty('output')) {
      return ret.output;
    } else {
      return 'ID[' + ret.id + ']';
    }
  }
  var seenObj = { id: seen.size };
  seen.set(val, seenObj);

  // TODO(alexfandrianto): UintXArray and the other TypedArray seem to be in
  // flux right now, with respect to their node and browser implementations.
  // TypedArray doesn't seem to exist in 'node', but it looks like it's being
  // added in the browser. For now, we will check if the internal buffer is an
  // ArrayBuffer to identify TypedArray in both node and browser.
  // https://github.com/vanadium/issues/issues/692
  if (Array.isArray(val) || val.buffer instanceof ArrayBuffer) {
    var arrStr = '[';
    for (var ai = 0; ai < val.length; ai++) {
      if (ai > 0) {
        arrStr += ',';
      }
      arrStr += stableCircularStringifyInternal(val[ai], seen);
    }
    arrStr += ']';
    // Attach the str to the object in seen to short-circuit lookup.
    seenObj.output = arrStr;
    return arrStr;
  }

  // Extract val's keys and values in a consistent order.
  var keys = [];
  var values = [];
  if (val instanceof Set || val instanceof Map) {
    // We have to make sure to print maps and sets in sorted key order.
    // While Set and Map have an iteration order equivalent to their insertion
    // order, we still want non-matching insertion orders to have matching
    // stringify output.
    val.forEach(function(value, key) {
      keys.push(key);
    });
    keys.sort();
    keys.forEach(function(key) {
      if (val instanceof Set) {
        values.push(true); // {X:true} is our desired format for set.
      } else {
        values.push(val.get(key));
      }
    });
  } else {
    // Extract and sort Object keys to ensure consistent key order.
    keys = Object.keys(val);
    keys.sort();
    keys.forEach(function(key) {
      values.push(val[key]);
    });
  }

  // Pretty print the object keys and values.
  var str = '{';
  for (i = 0; i < keys.length; i++) {
    if (i > 0) {
      str += ',';
    }
    str += stableCircularStringifyInternal(keys[i], seen);
    str += ':';
    str += stableCircularStringifyInternal(values[i], seen);
  }
  str += '}';
  // Attach the str to the object in seen to short-circuit lookup.
  seenObj.output = str;
  return str;
}

/**
 * Converts an object to a string in a stable manner, outputting ids for cycles.
 * This is necessary because JSON stringify won't handle circular types
 * properly and is not guaranteed to be stable for maps.
 * TODO(bprosnitz) Make this faster.
 * @private
 * @param {Type} type the type object.
 * @return {string} The key.
 */
function stableCircularStringify(val) {
  return stableCircularStringifyInternal(val, new Map());
}

},{"./es6-shim":131}],142:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Defines the function that checks for type compatibility.
 * This logic duplicates that of v23/vdl/compatible.go
 * Compatible: Two types can potentially convert to each other.
 * Convertible: A value with one type can be converted to a second type.
 * See canonicalize.js for the function that converts a value to a given type.
 * @private
 */

var kind = require('./kind.js');
var types = require('./types.js');
require('./es6-shim');

module.exports = compatible;

/*
 * Returns whether or not these types are compatible with each other.
 * @param {Type | undefined} a The first type (undefined for native values)
 * @param {Type | undefined} b The second type (undefined for native values)
 * @return {boolean} Whether or not the types are compatible.
 */
function compatible(a, b) {
  return compat(a, b, new Set(), new Set());
}

/*
 * Helper for compatible. Keeps track of the set of ancestors for each type.
 * This chain of ancestors allows detection of recursive types. When detected,
 * the function returns true (potentially, a false positive).
 * @param {Type | undefined} a The first type (undefined for native values)
 * @param {Type | undefined} b The second type (undefined for native values)
 * @param {set[Type]} seenA The set of ancestor types for type a.
 * @param {set[Type]} seenB The set of ancestor types for type b.
 * @return {boolean} Whether or not the types are compatible.
 */
function compat(a, b, seenA, seenB) {
  // Native types are always compatible with everything.
  if (a === undefined || b === undefined) {
    return true;
  }

  // Drop optionals. ?foo is compatible with foo.
  if (a.kind === kind.OPTIONAL) {
    a = a.elem;
  }
  if (b.kind === kind.OPTIONAL) {
    b = b.elem;
  }

  // If the types match, return true.
  // Note: Allow recursive types to be compatible to avoid infinite loop.
  // Like compatible.go, this returns true if any cycles are detected. This
  // avoids infinite loops and simpler checks at the cost of a little more work
  // in canonicalize. Recursive types are rare, so this doesn't matter much.
  // TODO(alexfandrianto): JS Sets actually allow us to detect shared references
  // So this may be solvable on our end. Go cannot do so very efficiently.
  if (a === b || seenA.has(a) || seenB.has(b)) {
    return true;
  }

  var ka = a.kind;
  var kb = b.kind;

  // Any is always compatible with everything.
  if (ka === kind.ANY || kb === kind.ANY) {
    return true;
  }

  // Numbers are only compatible with numbers.
  var nA = isNumber(a);
  var nB = isNumber(b);
  if (nA || nB) {
    return nA && nB;
  }

  // Booleans are only compatible with booleans.
  if (ka === kind.BOOL || kb === kind.BOOL) {
    return ka === kind.BOOL && kb === kind.BOOL;
  }

  // Type objects are only compatible with type objects.
  if (ka === kind.TYPEOBJECT || kb === kind.TYPEOBJECT) {
    return ka === kind.TYPEOBJECT && kb === kind.TYPEOBJECT;
  }

  // Handle string, enum, []byte here. []byte is not compatible with []number
  var sA = isStringEnumBytes(a);
  var sB = isStringEnumBytes(b);
  if (sA || sB) {
    return sA && sB;
  }

  // Track composite types. Only these can be recursive.
  seenA.add(a);
  seenB.add(b);

  // Handle composites types.
  switch(ka) {
    case kind.ARRAY:
    case kind.LIST:
      switch(kb) {
        case kind.ARRAY:
        case kind.LIST:
          return compat(a.elem, b.elem, seenA, seenB);
      }
      return false;
    case kind.SET:
      switch(kb) {
        case kind.SET:
          return compat(a.key, b.key, seenA, seenB);
        case kind.MAP:
          // Note: Swap a and b. The helper needs a map first.
          return compatMapKeyElem(b, a.key, types.BOOL, seenB, seenA);
        case kind.STRUCT:
          // Note: Swap a and b. The helper needs a struct first.
          return compatStructKeyElem(b, a.key, types.BOOL, seenB, seenA);
      }
      return false;
    case kind.MAP:
      switch(kb) {
        case kind.SET:
          return compatMapKeyElem(a, b.key, types.BOOL, seenA, seenB);
        case kind.MAP:
          return compatMapKeyElem(a, b.key, b.elem, seenA, seenB);
        case kind.STRUCT:
          // Note: Swap a and b. The helper needs a struct first.
          return compatStructKeyElem(b, a.key, a.elem, seenA, seenB);
      }
      return false;
    case kind.STRUCT:
      switch(kb) {
        case kind.SET:
          return compatStructKeyElem(a, b.key, types.BOOL, seenA, seenB);
        case kind.MAP:
          return compatStructKeyElem(a, b.key, b.elem, seenB, seenA);
        case kind.STRUCT:
          // Special: empty struct is compatible to all other structs
          if (isEmptyStruct(a) || isEmptyStruct(b)) {
            return true;
          }
          return compatFields(a, b, seenA, seenB);
      }
      return false;
    case kind.UNION:
      switch (kb) {
        case kind.UNION:
          return compatFields(a, b, seenA, seenB);
      }
      return false;
    default:
      throw new Error('compatible received unhandled types ' + a.toString() +
        ' and ' + b.toString());
  }
}

// Helper to determine if a map and a key-elem combo are compatible.
// Requirement: a is a map type.
// Keys and elems must be compatible.
function compatMapKeyElem(a, bKey, bElem, seenA, seenB) {
  // Note: Use a separate copy of the ancestors-seen set for the keys.
  return compat(a.key, bKey, setCopy(seenA), setCopy(seenB)) &&
    compat(a.elem, bElem, seenA, seenB);
}

// Helper to determine if a struct and a key-elem combo are compatible.
// Requirement: a is a struct type.
// Key must be string-compatible, elem must be compatible with all struct fields
function compatStructKeyElem(a, bKey, bElem, seenA, seenB) {
  if (isEmptyStruct(a)) {
    return false; // empty struct can't convert to map/set
  }
  if (!compat(types.STRING, bKey, seenA, seenB)) {
    return false;
  }
  for (var i = 0; i < a.fields.length; i++) {
    // Note: Each field needs an independent copy of the ancestors-seen set.
    if (!compat(a.fields[i].type, bElem, setCopy(seenA), setCopy(seenB))) {
      return false;
    }
  }
  return true;
}


// Helper to determine if a struct or union's fields match.
// Requirement: a and b are struct or union types.
// Name matches must have compatible types, with at least 1 match.
function compatFields(a, b, seenA, seenB) {
  var fieldMatches = false;

  // Go through each field combination.
  for (var i = 0; i < a.fields.length; i++) {
    var fieldA = a.fields[i];
    for (var j = 0; j < b.fields.length; j++) {
      var fieldB = b.fields[j];

      // As soon as any name matches, stop to inspect.
      if (fieldA.name !== fieldB.name) {
        continue;
      } else {
        // Note: Each field needs an independent copy of the ancestors-seen set.
        var typeMatch = compat(fieldA.type, fieldB.type, setCopy(seenA),
          setCopy(seenB));
        // Return false if despite a name match, the types did not match.
        if (!typeMatch) {
          return false;
        }
        fieldMatches = true;
        break;
      }
    }
  }
  return fieldMatches;
}

// Returns a copy of the given set.
// TODO(alexfandrianto): May be inefficient. Used to detect recursive types.
// An alternative is to use branch ids when descending down the type graph.
function setCopy(set) {
  var s = new Set();
  set.forEach(function(key) {
    s.add(key);
  });
  return s;
}

// Helper to determine if the type represents a number.
function isNumber(t) {
  switch(t.kind) {
    case kind.BYTE: // TODO(alexfandrianto): Byte is not a number.
    case kind.UINT16:
    case kind.UINT32:
    case kind.UINT64:
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
    case kind.INT64:
    case kind.FLOAT32:
    case kind.FLOAT64:
    case kind.COMPLEX64:
    case kind.COMPLEX128:
      return true;
  }
  return false;
}

// Helper to determine if the type is a string, enum, or byte array/slice.
function isStringEnumBytes(t) {
  return t.kind === kind.STRING || t.kind === kind.ENUM ||
    (t.kind === kind.LIST && t.elem.kind === kind.BYTE) ||
    (t.kind === kind.ARRAY && t.elem.kind === kind.BYTE);
}

// Helper to determine if this struct is empty.
// Requirement: t is a struct.
function isEmptyStruct(t) {
  return t.fields.length === 0;
}

},{"./es6-shim":131,"./kind.js":136,"./types.js":146}],143:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Utility for converting from a kind to a TypeObject.
 * @private
 */

var kind = require('./kind.js');
var Type = require('./type.js');
var types = require('./types.js');

module.exports = typeObjectFromKind;

// All Types below are constructed with 'isValidated' set to true. This avoids a
// cyclic dependency with canonicalize.js and type.js.
var _primitiveTypeObject = new Type({
  name: 'PrimitiveTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    }
  ]
}, true);

var _optionalTypeObject = new Type({
  name: 'OptionalTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Elem',
      type: types.TYPEOBJECT
    }
  ]
}, true);

var _enumTypeObject = new Type({
  name: 'EnumTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Labels',
      type: new Type({
        kind: kind.LIST,
        elem: types.STRING
      }, true)
    }
  ]
}, true);

var _listTypeObject = new Type({
  name: 'ListTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Elem',
      type: types.TYPEOBJECT
    }
  ]
}, true);

var _arrayTypeObject = new Type({
  name: 'ArrayTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Elem',
      type: types.TYPEOBJECT
    },
    {
      name: 'Len',
      type: types.UINT32
    }
  ]
}, true);

var _setTypeObject = new Type({
  name: 'SetTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Key',
      type: types.TYPEOBJECT
    }
  ]
}, true);

var _mapTypeObject = new Type({
  name: 'MapTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Key',
      type: types.TYPEOBJECT
    },
    {
      name: 'Elem',
      type: types.TYPEOBJECT
    }
  ]
}, true);

var _structTypeObject = new Type({
  name: 'StructTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Fields',
      type: new Type({
        kind: kind.LIST,
        elem: new Type({
          kind: kind.STRUCT,
          fields: [
            {
              name: 'Name',
              type: types.STRING
            },
            {
              name: 'Type',
              type: types.TYPEOBJECT
            }
          ]
        }, true)
      }, true)
    }
  ]
}, true);

var _unionTypeObject = new Type({
  name: 'UnionTypeObject',
  kind: kind.STRUCT,
  fields: [
    {
      name: 'Kind',
      type: types.STRING
    },
    {
      name: 'Name',
      type: types.STRING
    },
    {
      name: 'Fields',
      type: new Type({
        kind: kind.LIST,
        elem: new Type({
          kind: kind.STRUCT,
          fields: [
            {
              name: 'Name',
              type: types.STRING
            },
            {
              name: 'Type',
              type: types.TYPEOBJECT
            }
          ]
        }, true)
      }, true)
    }
  ]
}, true);

/**
 * Returns the corresponding type object for a given kind.
 * @private
 * @param {kind} k The kind.
 * @return {TypeObject} The corresponding type object.
 */
function typeObjectFromKind(k) {
  switch (k) {
    case kind.BOOL:
    case kind.BYTE:
    case kind.UINT16:
    case kind.UINT32:
    case kind.UINT64:
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
    case kind.INT64:
    case kind.FLOAT32:
    case kind.FLOAT64:
    case kind.COMPLEX64:
    case kind.COMPLEX128:
    case kind.STRING:
    case kind.ANY:
    case kind.TYPEOBJECT:
      return _primitiveTypeObject;
    case kind.OPTIONAL:
      return _optionalTypeObject;
    case kind.ENUM:
      return _enumTypeObject;
    case kind.LIST:
      return _listTypeObject;
    case kind.ARRAY:
      return _arrayTypeObject;
    case kind.SET:
      return _setTypeObject;
    case kind.MAP:
      return _mapTypeObject;
    case kind.STRUCT:
      return _structTypeObject;
    case kind.UNION:
      return _unionTypeObject;
    default:
      throw new TypeError('Unknown kind ' + k);
  }
}

},{"./kind.js":136,"./type.js":145,"./types.js":146}],144:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Defines helpers for dealing with types.
 * @private
 */

var kind = require('./kind.js');

module.exports = {
  shouldSendLength: shouldSendLength,
  hasAny: hasAny,
  hasTypeObject: hasTypeObject,
  unwrap: unwrap,
  unwrapNonDefault: unwrapNonDefault,
  recursiveUnwrap: recursiveUnwrap,
  isTyped: isTyped,
  isWrapped: isWrapped,
  constructorOf: constructorOf
};

/**
 * Determines if the length should be sent in the header of a value message of
 * the specified type.
 * @private
 * @param {module:vanadium.vdl.Type} type The type.
 * @return {boolean} true if the length should be sent in the header of the
 * the value message or false otherwise.
 */
function shouldSendLength(type) {
  if (type.kind === kind.ARRAY || type.kind === kind.LIST) {
    return type.elem.kind !== kind.BYTE;
  }
  switch (type.kind) {
    case kind.COMPLEX64:
    case kind.COMPLEX128:
    case kind.SET:
    case kind.MAP:
    case kind.STRUCT:
    case kind.ANY:
    case kind.UNION:
    case kind.OPTIONAL:
      return true;
    default:
      return false;
  }
}

/**
 * Determines if the type contains an any, recursively within it.
 * @private
 * @param {module:vanadium.vdl.Type} type The type.
 * @return {boolean} true if the type contains an any or type object.
 */
function hasAny(type) {
  return hasAnyInternal(type, new Set());
}

function hasAnyInternal(type, seen) {
  if (seen.has(type)) {
    return false;
  }
  seen.add(type);

  switch (type.kind) {
    case kind.ANY:
      return true;
    case kind.OPTIONAL:
    case kind.LIST:
    case kind.ARRAY:
      return hasAnyInternal(type.elem, seen);
    case kind.SET:
      return hasAnyInternal(type.key, seen);
    case kind.MAP:
      return hasAnyInternal(type.key, seen) ||
        hasAnyInternal(type.elem, seen);
    case kind.UNION:
    case kind.STRUCT:
      for (var f = 0; f < type.fields.length; f++) {
        var field = type.fields[f];
        if (hasAnyInternal(field.type, seen)) {
          return true;
        }
      }
      return false;
    default:
      return false;
  }
}

/**
 * Determines if the type contains a type object, recursively within it.
 * @private
 * @param {module:vanadium.vdl.Type} type The type.
 * @return {boolean} true if the type contains an any or type object.
 */
function hasTypeObject(type) {
  return hasTypeObjectInternal(type, new Set());
}

function hasTypeObjectInternal(type, seen) {
  if (seen.has(type)) {
    return false;
  }
  seen.add(type);

  switch (type.kind) {
    case kind.TYPEOBJECT:
      return true;
    case kind.OPTIONAL:
    case kind.LIST:
    case kind.ARRAY:
      return hasTypeObjectInternal(type.elem, seen);
    case kind.SET:
      return hasTypeObjectInternal(type.key, seen);
    case kind.MAP:
      return hasTypeObjectInternal(type.key, seen) ||
        hasTypeObjectInternal(type.elem, seen);
    case kind.UNION:
    case kind.STRUCT:
      for (var f = 0; f < type.fields.length; f++) {
        var field = type.fields[f];
        if (hasTypeObjectInternal(field.type, seen)) {
          return true;
        }
      }
      return false;
    default:
      return false;
  }
}

function _isObject(v) {
  return (typeof v === 'object' && v !== null);
}

/**
 * Checks whether the given value is a typed value.
 * @private
 * @param {*} v The potentially typed value.
 * @return {boolean} whether the value has a type attached or not.
 */
function isTyped(v) {
  return _isObject(v) && _isObject(v._type);
}

/**
 * Checks whether the given value is a wrapped value.
 * @private
 * @param {VomValue} v The potentially wrapped value.
 * @return {boolean} whether the value was wrapped or not.
 */
function isWrapped(v) {
  return (isTyped(v) && v._wrappedType === true);
}

/**
 * Unwrap the value in a potentially wrapped type.
 * Note: The convention is to only wrap types once, not deeply.
 * @private
 * @param {VomValue} v The value to be unwrapped.
 * @return {*} the unwrapped value.
 */
function unwrap(v) {
  if (isWrapped(v)) {
    v = v.val;
  }
  return v;
}

/**
 * Obtain the constructor (if available) of the given value.
 * The constructor can be a WrappedConstructor, StructConstructor, or Type.
 * TODO(alexfandrianto): This will be removed; canonicalize will instead use the
 * registry to lookup the constructor, instead of relying on this.
 * @private
 * @param {VomValue} v The value to be unwrapped.
 * @return {Constructor?} a constructor if v is wrapped, null otherwise.
 */
function constructorOf(v) {
  if (isWrapped(v)) {
    return v.constructor;         // WrappedConstructor
  } else if (_isObject(v) && _isObject(v._type)) {
    return v.constructor || null; // StructConstructor, TypeConstructor, or null
  }
  return null;
}

/**
 * Unwrap the value if the unwrapped type will be guessed on encode.
 * @private
 * @param {VomValue} v The value to be unwrapped.
 * @return {*} the unwrapped value.
 */
function unwrapNonDefault(v) {
  // TODO(bprosnitz) This function doesn't match the default guess rules.
  // Update this to do more than just check for the name field.
  if (isWrapped(v) && !v._type.hasOwnProperty('name')) {
    return unwrap(v);
  }
  return v;
}

// recursively descent the object and unwrap the value.
function recursiveUnwrap(val) {
  if (typeof val !== 'object' || val === null) {
    return val;
  }

  var lastVal;
  while (lastVal !== val) {
    lastVal = val;
    val = unwrap(val);
  }

  if (val instanceof Map) {
    var replacementMap = new Map();
    val.forEach(function(value, key) {
      var unwrappedKey = recursiveUnwrap(key);
      var unwrappedValue = recursiveUnwrap(value);
      replacementMap.set(unwrappedKey, unwrappedValue);
    });
    return replacementMap;
  }

  if (val instanceof Set) {
    var replacementSet = new Set();
    val.forEach(function(key) {
      var unwrappedKey = recursiveUnwrap(key);
      replacementSet.add(unwrappedKey);
    });
    return replacementSet;
  }

  for (var key in val) {
    if (val.hasOwnProperty(key)) {
      val[key] = recursiveUnwrap(val[key]);
    }
  }
  return val;
}

},{"./kind.js":136}],145:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Constructor for Type. This is temporary and the type registry
 * should be used in its place.
 * TODO(alexfandrianto): If this is temporary, how can type registry take the
 * place of the Type Constructor?
 * @private
 */

module.exports = Type;

var kind = require('./kind');
var canonicalize; // Must be lazily-required to avoid circular dependency.

/**
 * @summary Creates a new Type.
 *
 * @description <p>Without o, the Type is incomplete and must be filled in
 * further.</p>
 * <p>Notably, each type has a kind, which implies the existence of other
 * fields.  Type can be optionally constructed with an object, which has the
 * option of being canonicalized.</p>
 * <p>Note: This sidesteps a cyclic dependency with injection. During module
 * setup, any calls to the Type constructor with a type object should also set
 * skipValidation to true.</p>
 * @constructor
 * @memberof module:vanadium.vdl
 * @param {Object=} o An object whose fields match those of a TypeObject.
 * @param {boolean=} skipValidation Flag to skip validation. Defaults to false.
 */
function Type(o, skipValidation) {
  if (o === undefined) {
    o = {};
  } else if (!skipValidation) {
    // Canonicalize the given type object.
    canonicalize = canonicalize || require('./canonicalize');
    o = canonicalize.type(o);
  }
  this.name = '';

  // Copy over o's fields into this type.
  // Note: This is a shallow copy. If o is referenced cyclically, the reference
  // is lost. Use canonicalize.type instead.
  Object.keys(o).forEach(function(k) {
    this[k] = o[k];
  }, this);
}

Type.prototype._type = new Type();
Type.prototype._type.kind = kind.TYPEOBJECT;

/**
 * Checks for equality
 * @param {*} other The value to check for equality against.
 * @return {boolean} True iff other equals this.
 */
Type.prototype.equals = function(other) {
  if (this === other) {
    return true;
  }


  return other && this.name === other.name && (other instanceof Type) &&
    this.toString() === other.toString();
};

/**
 * Freeze a type, setting its _unique string.
 */
Type.prototype.freeze = function() {
  if (!Object.isFrozen(this)) {
    var descriptor = {
      value: this.toString()
    };
    Object.defineProperty(this, '_unique', descriptor);
    Object.freeze(this);
  }
};

/**
 * Get a human-readable string for this type.
 * @return {string} The human-readable string for this type
 */
Type.prototype.toString = function() {
  if (this._unique) {
    return this._unique;
  }
  return uniqueTypeStr(this, []);
};

/**
 * <p>Compute a unique type string that breaks cycles.</p>
 *
 * <p>Note: This logic replicates that of uniqueTypeStr in type_builder.go.</p>
 * @private
 * @param {Type} t The type whose unique type string is needed
 * @param {Array} seen A list of seen type references
 * @return {string} The string representation of the given type
 */
function uniqueTypeStr(t, seen) {
  if (seen.indexOf(t) !== -1 && t.name !== '') {
    return t.name;
  }
  seen.push(t);
  var s = t.name;
  if (s !== '') {
    s += ' ';
  }
  switch (t.kind) {
    case kind.OPTIONAL:
      return s + '?' + uniqueTypeStr(t.elem, seen);
    case kind.ENUM:
      return s + 'enum{' + t.labels.join(';') + '}';
    case kind.ARRAY:
      return s + '[' + t.len + ']' + uniqueTypeStr(t.elem, seen);
    case kind.LIST:
      return s + '[]' + uniqueTypeStr(t.elem, seen);
    case kind.SET:
      return s + 'set[' + uniqueTypeStr(t.key, seen) + ']';
    case kind.MAP:
      return s + 'map[' + uniqueTypeStr(t.key, seen) + ']' +
        uniqueTypeStr(t.elem, seen);
    case kind.STRUCT:
    case kind.UNION:
      if (t.kind === kind.STRUCT) {
        s += 'struct{';
      } else {
        s += 'union{';
      }
      t.fields.forEach(function (f, index) {
        if (index > 0) {
          s += ';';
        }
        s += f.name + ' ' + uniqueTypeStr(f.type, seen);
      });
      return s + '}';
    default:
      return s + t.kind;
  }
}

},{"./canonicalize":126,"./kind":136}],146:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Utilities for manipulating types.
 * @private
 */

var Type = require('./type.js');
var kind = require('./kind.js');

// TODO(bprosnitz) Should we add other helpers? Or is it better just to directly
// create the types in js?

/**
 * @summary Namespace of pre-defined VDL Types.
 * @description Namespace of pre-defined VDL Types.
 * @namespace
 * @memberof module:vanadium.vdl
 */
var types = {
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  ANY: primitiveType(kind.ANY),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  BOOL: primitiveType(kind.BOOL),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  BYTE: primitiveType(kind.BYTE),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  UINT16: primitiveType(kind.UINT16),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  UINT32: primitiveType(kind.UINT32),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  UINT64: primitiveType(kind.UINT64),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  INT8: primitiveType(kind.INT8),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  INT16: primitiveType(kind.INT16),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  INT32: primitiveType(kind.INT32),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  INT64: primitiveType(kind.INT64),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  FLOAT32: primitiveType(kind.FLOAT32),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  FLOAT64: primitiveType(kind.FLOAT64),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  COMPLEX64: primitiveType(kind.COMPLEX64),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  COMPLEX128: primitiveType(kind.COMPLEX128),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  STRING: primitiveType(kind.STRING),
  /**
   * @type {module:vanadium.vdl.Type}
   * @const
   */
  TYPEOBJECT: Type.prototype._type // So that === works for types.TypeObject
};
/**
 * @type {module:vanadium.vdl.Type}
 * @const
 */
types.ERROR = defineOptionalErrorType();

/**
 * @type {module:vanadium.vdl.Type}
 * @const
 */
types.JSVALUE = defineJSValueType();

module.exports = types;

function defineOptionalErrorType() {
  var nilErrorType = new Type();

  // TODO(bprosnitz) Should we add an error constructor so error objects have
  // the same prototype? (this will be the case once this is generated by VDL as
  // well)
  var retryCodeType = new Type();
  retryCodeType.name = '';
  retryCodeType.kind = kind.ENUM;
  retryCodeType.labels = [
    'NoRetry',
    'RetryConnection',
    'RetryRefetch',
    'RetryBackoff'
  ];
  var paramListType = new Type();
  paramListType.name = '';
  paramListType.kind = kind.LIST;
  paramListType.elem = types.ANY;

  var errorType = new Type();
  errorType.name = 'error';
  errorType.kind = kind.STRUCT;
  errorType.fields = [
    {
      name: 'Id',
      type: types.STRING
    },
    {
      name: 'RetryCode',
      type: retryCodeType
    },
    {
      name: 'Msg',
      type: types.STRING
    },
    {
      name: 'ParamList',
      type: paramListType
    }
  ];
  nilErrorType.name = '';
  nilErrorType.kind = kind.OPTIONAL;
  nilErrorType.elem = errorType;

  return nilErrorType;
}

// The JSValueType is a special type for JavaScript. Services will default to
// sending and receiving this type when they do not specify a type in their
// service signature.
// TODO(alexfandrianto): We are still use types.ANY instead of types.JSVALUE.
// TODO(alexfandrianto): We should consider moving this type into VDL.
// See the issue: https://github.com/veyron/release-issues/issues/760
// Warning: In the rare case that someone defines their own JSValue, they will
// not have the expected behavior in encode/decode/canonicalize because JSValue
// is heavily special-cased.
function defineJSValueType() {
  var JSValueType = new Type();
  var EmptyStruct = new Type();
  var ByteList = new Type();
  var JSValueList = new Type();
  var JSKeyValueList = new Type();
  var JSKeyValuePair = new Type();
  var JSStringValueList = new Type();
  var JSStringValuePair = new Type();

  // Fill JSValue
  JSValueType.name = 'JSValue';
  JSValueType.kind = kind.UNION;
  JSValueType.fields = [
    {
      name: 'Null',
      type: EmptyStruct
    },
    {
      name: 'Boolean',
      type: types.BOOL
    },
    {
      name: 'Number',
      type: types.FLOAT64
    },
    {
      name: 'String',
      type: types.STRING
    },
    {
      name: 'Bytes',
      type: ByteList
    },
    {
      name: 'List',
      type: JSValueList
    },
    {
      name: 'Set',
      type: JSValueList
    },
    {
      name: 'Map',
      type: JSKeyValueList
    },
    {
      name: 'Object',
      type: JSStringValueList
    }
  ];

  // Define the rest of EmptyStruct
  // Add a name, since VDL does not allow unnamed, empty structs.
  EmptyStruct.kind = kind.STRUCT;
  EmptyStruct.fields = [];
  EmptyStruct.name = 'EmptyStruct';

  // Define the rest of ByteList
  ByteList.kind = kind.LIST;
  ByteList.elem = types.BYTE;

  // Define the rest of JSValueList
  JSValueList.kind = kind.LIST;
  JSValueList.elem = types.ANY;

  // Define the rest of JSKeyValueList
  JSKeyValueList.kind = kind.LIST;
  JSKeyValueList.elem = JSKeyValuePair;

  // Define the rest of JSKeyValuePair
  JSKeyValuePair.kind = kind.STRUCT;
  JSKeyValuePair.fields = [
    {
      name: 'Key',
      type: types.ANY
    },
    {
      name: 'Value',
      type: types.ANY
    }
  ];

  // Define the rest of JSStringValueList
  JSStringValueList.kind = kind.LIST;
  JSStringValueList.elem = JSStringValuePair;

  // Define the rest of JSStringValuePair
  JSStringValuePair.kind = kind.STRUCT;
  JSStringValuePair.fields = [
    {
      name: 'Key',
      type: types.STRING
    },
    {
      name: 'Value',
      type: types.ANY
    }
  ];

  return JSValueType;
}

// Primitive types only need a kind. They have an empty name by default.
function primitiveType(kind) {
  var prim = new Type();
  prim.kind = kind;
  return prim;
}

},{"./kind.js":136,"./type.js":145}],147:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Defines helpers for miscellaneous operations.
 * @private
 */
module.exports = {
  capitalize: capitalize,
  uncapitalize: uncapitalize,
  isCapitalized: isCapitalized,
  isExportedStructField: isExportedStructField,
  getFirstDefinedPropertyKey: getFirstDefinedPropertyKey
};

/**
 * Copies and capitalizes the first letter of the given string.
 * @private
 * @param {string} s The string.
 * @return {string} copy of the string with the first letter upper-cased.
 */
function capitalize(s) {
  return s[0].toUpperCase() + s.substr(1);
}

/**
 * Copies and uncapitalizes the first letter of the given string.
 * @private
 * @param {string} s The string.
 * @return {string} copy of the string with the first letter lower-cased.
 */
function uncapitalize(s) {
  return s[0].toLowerCase() + s.substr(1);
}

/**
 * Checks if the first letter of the given string is capitalized.
 * Note: Strings starting with a special character are considered capitalized.
 * @private
 * @param {string} s The string.
 * @return {boolean} whether or not the string is capitalized.
 */
function isCapitalized(s) {
  return s[0].toUpperCase() === s[0];
}

/**
 * Returns true if the field doesn't start with '_'.
 * @param {string} field The field label of a struct.
 * @private
 * @return {boolean} whether or not the field should be exported.
 */
function isExportedStructField(field) {
  return field.length > 0 && field[0] !== '_';
}

/**
 * Returns the key of the first defined property in the object.
 * If there were no keys, or all keys had field value undefined, then this
 * returns undefined.
 * @private
 * @param {object} o The object
 * @return {string | undefined} The key of the first defined field in o.
 */
function getFirstDefinedPropertyKey(o) {
  var keys = Object.keys(o);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (o[key] !== undefined) {
      return key;
    }
  }
  return;
}

},{}],148:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * Represents the action expected to be performed by a typical client receiving
 * an error that perhaps it does not understand.
 * @namespace actions
 * @memberof module:vanadium.verror
 */
module.exports = {
  /**
   * Do not retry.
   * @const
   * @memberof module:vanadium.verror.actions
   */
  NO_RETRY: 'NoRetry',
  /**
   * Renew high-level connection/context.
   * @const
   * @memberof module:vanadium.verror.actions
   */
  RETRY_CONNECTION: 'RetryConnection',
  /**
   * Refetch and retry (e.g., out of date HTTP ETag).
   * @const
   * @memberof module:vanadium.verror.actions
   */
  RETRY_REFETCH: 'RetryRefetch',
  /**
   * Backoff and retry a finite number of times.
   * @const
   * @memberof module:vanadium.verror.actions
   */
  RETRY_BACKOFF: 'RetryBackoff'
};
},{}],149:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

module.exports = Catalog;
var formatError = require('./format');

function Catalog() {
  this.formats = {};
}

function baseLang(lang) {
  return lang.split('-')[0];
}

/**
 * lookups the language/msgId pair in the catalog.
 *
 * @private
 * @param {string} lang the language code
 * @param {string} msgId the id of the error
 * @returns {string|null} the format string for the lang/msgId pair or null.
 */
Catalog.prototype._lookup = function(lang, msgId) {
  var langMap = this.formats[lang];
  if (!langMap) {
    return null;
  }
  return langMap[msgId];
};

/**
 * lookups the language/msgId pair in the catalog. If there is no match
 * on the full language the string the base language (i.e 'en' for 'en-US') is
 * looked up instead.
 *
 * @private
 * @param {string} lang the language code
 * @param {string} msgId the id of the error
 * @returns {string} the format string for the lang/msgId pair.
 */
Catalog.prototype.lookup = function(lang, msgId) {
  var defaultFormat = msgId + '{:_}';
  return this._lookup(lang, msgId) ||
    this._lookup(baseLang(lang), msgId) ||
    defaultFormat;
};

Catalog.prototype.format = function(lang, msgId, args) {
  return formatError(this.lookup(lang, msgId), args);
};

/**
 * sets the format for the lang/msgId pair
 * @private
 * @param {string} lang the language code
 * @param {string} msgId the id of the error
 * @param {string} format the format of the message
 */
Catalog.prototype.set = function(lang, msgId, format) {
  var langs = this.formats[lang];
  if (!langs) {
    this.formats[lang] = {};
    langs = this.formats[lang];
  }
  langs[msgId] = format;
};

/**
 * sets the format for the lang/msgId pair. Also sets the format for
 * the base of the language if no format exists for it.
 * @private
 * @param {string} lang the language code
 * @param {string} msgId the id of the error
 * @param {string} format the format of the message
 */
Catalog.prototype.setWithBase = function (lang, msgId, format) {
  this.set(lang, msgId, format);
  var base = baseLang(lang);
  if (!this._lookup(base, msgId, format)) {
    this.set(base, msgId, format);
  }
};

var escapedStringRe = /"([^"\\]|\\.)*"/;

/**
 * Merges the catalog data passed in.
 * Each valid line will have three parts. It will be:
 *   <langId> <msgId> "<format>"
 * format will be enclosed in quotes and escaped properly.
 * If the line begins with '#' or is malformed, it is ignored.
 * @private
 * @param {string} data the language code
 */
Catalog.prototype.merge = function(data) {
  var catalog = this;
  data.split('\n').forEach(function(line) {
   var parts = line.split(/\s+/);
    if (parts.length < 3) {
      return;
    }
    var langId = parts[0];
    if (langId[0] === '#') {
      return;
    }
    var msgId = parts[1];
    // The message is quoted, so we need to unquote it.
    var message = parts.splice(2).join(' ');
    var match = escapedStringRe.exec(message);
    if (!match) {
      return;
    }
    try {
      message = JSON.parse(match[0]);
    } catch (e) {
      return;
    }
    catalog.setWithBase(langId, msgId, message);
  });
};

},{"./format":150}],150:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// matches: {:_}, {2}, {3:}
var substitutionRe = /{(:?)(\d+|_)(:?)}/g;
var numberedRegexp = /{:?(\d+):?}/g;
var digitsRe = /\d+/;
var underscoreRe = /{:?_:?}/g;

/**
 *  <p>Formats the args passed into using fmtString.  The format string has
 *  placeholders for substitutions of the form {1}, where 1 means the first
 *  argument in the argument list.  If the number is preceded by a ':' it means
 *  emit a ': ' before the argument if the argument is non-empty. For
 *  instance:</p>
 *
 *  formatParams('foo{:1}', ['bar']) -> 'foo: bar'
 *  formatParams('foo{:1}', ['']) -> 'foo'
 *
 *
 *  <p>If the number if followed by a ':' then we emit a ':' after the argument
 *  if it is non-empty.  For instance:</p>
 *
 *  formatParams('{1:}foo', ['bar']) -> 'bar:foo'
 *  formatParams('{1:}foo', ['']) -> 'foo'
 *
 *  <p>If {_} exists in the format string any unused arguments are emitted at
 *  that point.  If any of the arguments are missing, then a '?' is emitted.</p>
 *  @private
 */
function formatParams(fmtString, args) {
  var matches = fmtString.match(numberedRegexp);
  var allArgsUsed = [];
  if (matches) {
    allArgsUsed = matches.map(function(s) {
      // We subtract one from the index because the indices in the format
      // string are 1-based.
      return parseInt(digitsRe.exec(s)[0] - 1);
    });
  }

  var unusedArgs = args.filter(function(s, idx) {
    return allArgsUsed.indexOf(idx) === -1;
  }).join(' ');

  // We count the number of underscores seen because we only perform the
  // substitution on the last underscore and we need to know which
  // instance to replace.
  var underscoreMatches = fmtString.match(underscoreRe);
  var underscoreCount = underscoreMatches ? underscoreMatches.length : 0;
  var underscoresSeen = 0;
  return fmtString.replace(substitutionRe, function(s, p1, p2, p3) {
    var value = '';
    if (p2 !== '_') {
      // We subtract one from the index because the indices in the format
      // string are 1-based.
      value = args[parseInt(p2) - 1];
      if (value === undefined) {
        value = '?';
      }
    } else {
      underscoresSeen++;
      if (underscoresSeen === underscoreCount) {
        value = unusedArgs;
      }
    }
    if (value === '') {
      return '';
    }

    var prefix = p1 === ':' ? ': ' : '';
    return prefix + value + p3;
  });
}
module.exports = formatParams;

},{}],151:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var extend = require('xtend');
var isBrowser = require('is-browser');

/**
 * @summary Namespace errors defines an error reporting mechanism that works
 * across programming environments, and a set of common errors.
 *
 * @description
 * <p>Namespace errors defines an error reporting mechanism that works
 * across programming environments, and a set of common errors.</p>
 *
 * <p>Each error has an identifier string, which is used for equality checks.
 * E.g. a Javascript client can check if a Go server returned a NoExist error by
 * checking the string identifier.  Error identifier strings start with the VDL
 * package path to ensure uniqueness, e.g. "v.io/v23/verror.NoExist".</p>
 *
 * <p>Each error contains an action, which is the suggested action for a typical
 * client to perform upon receiving the error.  E.g. some action codes represent
 * whether to retry the operation after receiving the error.</p>
 *
 * <p>Each error also contains a list of typed parameters, and an error message.
 * The error message is created by looking up a format string keyed on the error
 * identifier, and applying the parameters to the format string.  This enables
 * error messages to be generated in different languages.</p>
 *
 * @namespace
 * @name verror
 * @memberof module:vanadium
 */
module.exports = extend(require('../gen-vdl/v.io/v23/verror'), {
  makeError: require('./make-errors'),
  actions: require('./actions'),
  VanadiumError: require('./vanadium-error'),
});

if (isBrowser) {
  // Extend extension errors if browser
  module.exports = extend(
    module.exports,
    require('../browser/extension-errors')
  );
}

},{"../browser/extension-errors":45,"../gen-vdl/v.io/v23/verror":57,"./actions":148,"./make-errors":152,"./vanadium-error":153,"is-browser":33,"xtend":41}],152:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var errorMap = require('../runtime/error-map');
var inherits = require('inherits');
var defaultCatalog = require('../runtime/default-catalog');
var VanadiumError = require('./vanadium-error');

module.exports = makeError;

/**
 * Returns a constructor that represents the error id
 * and retryCode passed in.
 * @param {string} id The unique id for this error type.  It is preferable
 * to prefix the error name with a package path that is unique.
 * @param {module:vanadium.verror.actions} retryCode The retry action for this
 * error.
 * @param {string|object} format If a string, then it's the en-US text string,
 * otherwise it is a map from languageId to format string.
 * @param {Array} types The array of types that expected for the arguments to
 * the error constructor.
 * @returns {function} A constructor function that can be used to create
 * vanadium errors with the given error id.  The returned constructor function
 * inherits from {@link module:vanadium.verror.VanadiumError}.
 * @memberof module:vanadium.verror
 */
function makeError(id, retryCode, format, types) {
  var fname = id.split('.').pop();
  var Errors = {};
  Errors[fname] = function() {
    var args = Array.prototype.slice.call(arguments);
    if (Array.isArray(args[0]) && args.length === 1) {
      args = args[0];
    }
    if (!(this instanceof Errors[fname])) {
      return new Errors[fname](args);
    }
    args.unshift(retryCode);
    args.unshift(id);
    VanadiumError.apply(this, args);
  };
  inherits(Errors[fname], VanadiumError);
  Errors[fname].prototype._argTypes = types || [];
  errorMap[id] = Errors[fname];
  if (typeof format === 'string') {
    format = {
      'en-US': format
    };
  }

  if (format) {
    var keys = Object.keys(format);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      defaultCatalog.setWithBase(key, id, format[key]);
    }
  }
  return Errors[fname];
}

},{"../runtime/default-catalog":100,"../runtime/error-map":102,"./vanadium-error":153,"inherits":32}],153:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var defaultCatalog = require('../runtime/default-catalog');
var defaultLanguage = require('../runtime/default-language');
var SharedContextKeys = require('../runtime/shared-context-keys');
var inherits = require('inherits');
var Types = require('../vdl/types');
var TypeUtil = require('../vdl/type-util');
module.exports = VanadiumError;

/**
 * @summary
 * The base error for all vanadium wire errors.  This class should not
 * be used directly, but all vanadium errors should inherit from
 * VanadiumError.
 * @constructor
 * @memberof module:vanadium.verror
 * @param {string} id The unique id for this error type.  It is preferable
 * to prefix the error name with a package path that is unique.
 * @param {module:vanadium.verror.actions} retryCode The retry action for
 * this error.
 * @param {module:vanadium.context.Context} ctx The context the error was
 * created in.
 * @param {...*} params A list of parameters to include in the error message.
 *
 * @property {string} id The unique id for this error type.
 * @property {module:vanadium.verror.actions} retryCode The retry action for
 * this error.
 * @property {Array.<*>} paramList A list of parameters to included in the error
 * message
 * this error.
 */
function VanadiumError() {
  var args = Array.prototype.slice.call(arguments);
  if (Array.isArray(args[0]) && args.length === 1) {
    args = arguments[0];
  }

  if (!(this instanceof VanadiumError)) {
    return new VanadiumError(args);
  }
  var id = args.shift();
  var retry = args.shift();
  var ctx = args.shift();
  this.paramList = args;
  this.id = id;
  this.retryCode = retry;
  if (ctx) {
    this._langId = ctx.value(SharedContextKeys.LANG_KEY) || defaultLanguage;
  } else {
    this._langId = defaultLanguage;
  }
  // The first argument is the server name.  For now well just pass in
  // app, but this should be in the context somehow.  The second parameter
  // is the operation.  This we can't get until vtrace works.
  // TODO(bjornick): Revisit after vtrace.
  args.unshift('op');
  if (ctx) {
    args.unshift(ctx.value(SharedContextKeys.COMPONENT_NAME) || 'app');
  } else {
    args.unshift('app');
  }
  this.msg = defaultCatalog.format(this._langId, id, args);

  Object.defineProperty(this,
                        'message',
                        {
                          value: this.msg,
                          writable: true
                        });

  if (typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(this, VanadiumError);
  } else {
    Object.defineProperty(this, 'stack', { value: (new Error()).stack });
  }
}
inherits(VanadiumError, Error);

VanadiumError.prototype.resetArgs = function() {
  var args = Array.prototype.slice.call(arguments);
  this.paramList = args;
  this.message = defaultCatalog.format(this._langId, this.id, args);
  this.msg = this.message;
};

VanadiumError.prototype._type = Types.ERROR.elem;

/**
 * Clones the error.
 * @return {module:vanadium.verror.VanadiumError} A deep copy of the error.
 */
VanadiumError.prototype.clone = function() {
  var res = Object.create(this.constructor.prototype);
  Object.defineProperty(res, 'constructor', { value: this.constructor });
  // Make a copy of the paramList.
  if (TypeUtil.isWrapped(this.paramList)) {
    res.paramList = Object.create(this.paramList.constructor.prototype);
    Object.defineProperty(res.paramList, 'constructor', {
      value: this.paramList.constructor
    });
    res.paramList.val = TypeUtil.unwrap(this.paramList).slice(0);
  } else {
    res.paramList = this.paramList.slice(0);
  }
  res.id = this.id;
  res.retryCode = this.retryCode;
  res._langId = this._langId;
  Object.defineProperty(res, 'message', { value: this.msg });
  res.msg = this.msg;
  Object.defineProperty(res, 'stack', { value: this.stack });
  return res;
};

},{"../runtime/default-catalog":100,"../runtime/default-language":101,"../runtime/shared-context-keys":105,"../vdl/type-util":144,"../vdl/types":146,"inherits":32}],154:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Definition of BinaryReader.
 * @private
 */

var Promise = require('../lib/promise');
var byteUtil = require('../vdl/byte-util');
module.exports = BinaryReader;

/**
 * BinaryReader assists in reading from a Uint8Array by keeping track of the
 * position being read.
 * @private
 * @param {Uint8Array} The buffer to read from.
 * @constructor
 */
function BinaryReader(buf) {
  this.pos = 0;
  this.buf = buf;
}

/**
 * Reads a byte from the bufer.
 * @return {Promise<number>} The byte value. EOF is represented by null.
 */
BinaryReader.prototype.readByte = function() {
  var val = this.buf[this.pos];
  this.pos++;
  if (val === undefined) {
    return Promise.reject(
      new Error('Failed to read byte, reached end of buffer'));
  }
  return Promise.resolve(val);
};

/**
 * Returns the next byte from the buffer without advancing the reader
 * @return {Promise<number>} The byte value. EOF is represented by null.
 */
BinaryReader.prototype.peekByte = function() {
  var val = this.buf[this.pos];
  if (val === undefined) {
    return Promise.reject(
      new Error('Failed to read byte, reached end of buffer'));
  }
  return Promise.resolve(val);
};

/**
 * Reads an array of bytes from the buffer.
 * @param {number} amt. The number of bytes to read.
 * @return {Promise<Uint8Array>} The byte array. If the whole size cannot be
 * read, null (representing EOF) is returned.
 */
BinaryReader.prototype.readByteArray = function(amt) {
  var arr = this.buf.subarray(this.pos, this.pos + amt);
  this.pos += amt;
  if (this.pos > this.buf.length) {
    return Promise.reject(
      new Error('Failed to read ' + amt + ' bytes. Hit EOF.'));
  }
  return Promise.resolve(arr);
};

BinaryReader.prototype.hasData = function() {
  return this.pos < this.buf.length;
};

BinaryReader.prototype.getHexBytes = function() {
  return byteUtil.bytes2Hex(this.buf.slice(this.pos));
};

},{"../lib/promise":73,"../vdl/byte-util":125}],155:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Definition of BinaryWriter.
 * @private
 */

module.exports = BinaryWriter;

var INITIAL_SIZE = 64;

/**
 * BinaryWriter assists in writing to a Uint8Array by expanding the buffer to
 * the necessary size and keeping track of the current write position.
 * @private
 * @constructor
 */
function BinaryWriter() {
  this.allocatedSize = INITIAL_SIZE;
  this.pos = 0;
  this.buf = new Uint8Array(this.allocatedSize);
}

/**
 * Ensures there is enough space for a write of the specified size in the
 * backing array.
 * This has the side effect of consuming the specified number of bytes from the
 * array so that they can no longer be used for future writes.
 * @param {number} amt The number of bytes that are needed for the next write.
 * @return {number} The position in the backing array to write to.
 */
BinaryWriter.prototype._reserve = function(amt) {
  var pos = this.pos;
  var amtNeeded = this.pos + amt;

  // Expand the buffer as much as necessary.
  var expand = getMinPowerOfTwo(this.allocatedSize, amtNeeded);
  if (expand > 1) {
    this.allocatedSize = this.allocatedSize * expand;
    var newBuf = new Uint8Array(this.allocatedSize);
    newBuf.set(this.buf);
    this.buf = newBuf;
  }

  this.pos += amt;
  return pos;
};

/**
 * Writes a byte to the backing Uint8Array.
 * @param {number} val The value of the byte to write.
 */
BinaryWriter.prototype.writeByte = function(val) {
  var pos = this._reserve(1);
  this.buf[pos] = val;
};

/**
 * Writes an array of bytes to the backing Uint8Array.
 * @param {number} val The byte array to write.
 */
BinaryWriter.prototype.writeByteArray = function(bytes) {
  var pos = this._reserve(bytes.length);
  this.buf.set(bytes, pos);
};

/**
 * Gets a Uint8Array of the written data.
 * @param {Uint8Array} The written data.
 */
BinaryWriter.prototype.getBytes = function() {
  return this.buf.subarray(0, this.pos);
};

/**
 * Gets position of buffer
 * @return {number} position of buffer
 */
BinaryWriter.prototype.getPos = function() {
  return this.pos;
};

/**
 * Seeks back to a previous position
 * @param {number} pos the new position.
 */
BinaryWriter.prototype.seekBack = function(pos) {
  if (pos > this.pos) {
    throw new Error('Cant seek forward');
  }
  this.pos = pos;
};



/**
 * Computes the smallest power of 2 to make current exceed target.
 * @private
 * @param {number} current, must be positive
 * @param {number} target
 * @return {number} smallest power of 2, where current * power >= target
 */
function getMinPowerOfTwo(current, target) {
  var power = 1;
  while (current * power < target) {
    power *= 2;
  }
  return power;
}

},{}],156:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Defines the set of initially known bootstrap type ids and their
 * corresponding VDL type.
 * @private
 */

module.exports = {
  definitions: undefined,
  idToType: idToType,
  typeToId: typeToId,
  typeStringToId: typeStringToId,
  unionIds: {
    NAMED_TYPE: 0,
    ENUM_TYPE: 1,
    ARRAY_TYPE: 2,
    LIST_TYPE: 3,
    SET_TYPE: 4,
    MAP_TYPE: 5,
    STRUCT_TYPE: 6,
    UNION_TYPE: 7,
    OPTIONAL_TYPE: 8,
  }
};

var kind = require('../vdl/kind.js');
var stringify = require('../vdl/stringify.js');
var types = require('../vdl/types.js');
var wiretype = require('../gen-vdl/v.io/v23/vom');
var unwrap = require('../vdl/type-util').unwrap;

var stringList = {
  name: '',
  kind: kind.LIST,
  elem: types.STRING
};

var bootstrapTypes = {
  ANY: {
    id: unwrap(wiretype.WireIdAny).toNativeNumberApprox(),
    type: types.ANY
  },
  BOOL: {
    id: unwrap(wiretype.WireIdBool).toNativeNumberApprox(),
    type: types.BOOL
  },
  STRING: {
    id: unwrap(wiretype.WireIdString).toNativeNumberApprox(),
    type: types.STRING
  },
  BYTE: {
    id: unwrap(wiretype.WireIdByte).toNativeNumberApprox(),
    type: types.BYTE
  },
  UINT16: {
    id: unwrap(wiretype.WireIdUint16).toNativeNumberApprox(),
    type: types.UINT16
  },
  UINT32: {
    id: unwrap(wiretype.WireIdUint32).toNativeNumberApprox(),
    type: types.UINT32
  },
  UINT64: {
    id: unwrap(wiretype.WireIdUint64).toNativeNumberApprox(),
    type: types.UINT64
  },
  INT8: {
    id: unwrap(wiretype.WireIdInt8).toNativeNumberApprox(),
    type: types.INT8
  },
  INT16: {
    id: unwrap(wiretype.WireIdInt16).toNativeNumberApprox(),
    type: types.INT16
  },
  INT32: {
    id: unwrap(wiretype.WireIdInt32).toNativeNumberApprox(),
    type: types.INT32
  },
  INT64: {
    id: unwrap(wiretype.WireIdInt64).toNativeNumberApprox(),
    type: types.INT64
  },
  FLOAT32: {
    id: unwrap(wiretype.WireIdFloat32).toNativeNumberApprox(),
    type: types.FLOAT32
  },
  FLOAT64: {
    id: unwrap(wiretype.WireIdFloat64).toNativeNumberApprox(),
    type: types.FLOAT64
  },
  COMPLEX64: {
    id: unwrap(wiretype.WireIdComplex64).toNativeNumberApprox(),
    type: types.COMPLEX64
  },
  COMPLEX128: {
    id: unwrap(wiretype.WireIdComplex128).toNativeNumberApprox(),
    type: types.COMPLEX128
  },
  LIST_BYTE: {
    id: unwrap(wiretype.WireIdByteList).toNativeNumberApprox(),
    type: {
      name: '',
      kind: kind.LIST,
      elem: types.BYTE
    }
  },
  TYPEOBJECT: {
    id: unwrap(wiretype.WireIdTypeObject).toNativeNumberApprox(),
    type: types.TYPEOBJECT
  },
  LIST_STRING: {
    id: unwrap(wiretype.WireIdStringList).toNativeNumberApprox(),
    type: stringList
  },
};
module.exports.definitions = bootstrapTypes;

var typeToIdMap = {};
var idToTypeMap = {};
for (var key in bootstrapTypes) {
  if (!bootstrapTypes.hasOwnProperty(key)) {
    continue;
  }
  var bootstrapType = bootstrapTypes[key];
  idToTypeMap[bootstrapType.id] = bootstrapType.type;
  typeToIdMap[stringify(bootstrapType.type)] =
    bootstrapType.id;
}

/**
 * Type to ID finds the bootstrap id for a type.
 * @private
 * @param {Type} type The type to search for.
 * @return {number} The bootstrap id or undefined if no boostrap type is found.
 */
function typeToId(type) {
  return typeToIdMap[stringify(type)];
}

/**
 * Type to ID finds the bootstrap id for a type.
 * @private
 * @param {Type} type The type to search for.
 * @return {number} The bootstrap id or undefined if no boostrap type is found.
 */
function typeStringToId(typeStr) {
  return typeToIdMap[typeStr];
}



/**
 * ID to type looks up the boostrap type for a given ID.
 * @private
 * @param {number} id The id of the boostrap type.
 * @return {Type} The bootstrap type or undefined if no boostrap type is found.
 */
function idToType(id) {
  return idToTypeMap[id];
}

},{"../gen-vdl/v.io/v23/vom":58,"../vdl/kind.js":136,"../vdl/stringify.js":141,"../vdl/type-util":144,"../vdl/types.js":146}],157:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Represents a read stream of VOM messages backed by a byte
 * array.
 * @private
 */

module.exports = ByteArrayMessageReader;

var RawVomReader = require('./raw-vom-reader.js');
var ByteMessageReader = require('./byte-message-reader.js');
var inherits = require('inherits');

/**
 * Create a VOM message reader backed by a byte array.
 * @param {Uint8Array} bytes The byte array.
 * @constructor
 * @memberof module:vanadium.vom
 */
function ByteArrayMessageReader(bytes) {
 ByteMessageReader.call(this, new RawVomReader(bytes));
}

inherits(ByteArrayMessageReader, ByteMessageReader);

},{"./byte-message-reader.js":158,"./raw-vom-reader.js":167,"inherits":32}],158:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Represents a read stream of VOM messages backed by a byte
 * array.
 * @private
 */

module.exports = ByteMessageReader;

var TypeUtil = require('../vdl/type-util.js');
var versions = require('./versions.js');
var wiretype = require('../gen-vdl/v.io/v23/vom');

/**
 * Create a generic VOM message reader.
 * @param {RawVomReader} rawReader= the underlying reader to use.
 * @constructor
 * @memberof module:vanadium.vom
 */
function ByteMessageReader(rawReader) {
  this.rawReader = rawReader;
  // Consume the header byte.
  var bmr = this;
  this.headerPromise = this.rawReader.readVersionByte().then(function(byte) {
    if (versions.allowedVersions.indexOf(byte) === -1) {
      throw new Error('Improperly formatted bytes. Must start with version');
    }
    bmr._version = byte;
  });
}

/**
 * Get the the type of the next value message.
 * @private
 * @param {TypeDecoder} typeDecoder The current type decoder.
 * @return {Promise<Type>} The type of the next message or null if the stream
 * has ended.
 */
ByteMessageReader.prototype.nextMessageType = function(typeDecoder) {
  this._typeIds = [];
  this._anyLens = [];
  var bsmr = this;
  return this.headerPromise.then(function() {
    return bsmr.rawReader.tryReadControlByte();
  }).then(function(ctrl) {
    if (ctrl === wiretype.WireCtrlTypeIncomplete.val) {
      // TODO(bprosnitz) We don't need to use type incomplete because the js
      // type decoder uses a less efficient algorithm than go to build types.
      // We should probably match the algorithm used by go.
    } else if (ctrl) {
      throw new Error('received unknown control byte: 0x' + ctrl.toString(16));
    }
    return bsmr.rawReader.readInt();
  }).then(function(typeId) {
    if (typeId < 0) {
      // Type message.  We add the type to the typeDecoder and continue reading
      // trying to find a value message.
      return  bsmr.rawReader.readUint().then(function(len) {
        return bsmr.rawReader._readRawBytes(len);
      }).then(function(body) {
        return typeDecoder.defineType(-typeId, body);
      }).then(function() {
        return bsmr.nextMessageType(typeDecoder);
      });
    }
    return typeDecoder.lookupType(typeId).then(function(type) {
      var next = Promise.resolve();
      if (bsmr._version !== versions.version80 &&
        (TypeUtil.hasAny(type) || TypeUtil.hasTypeObject(type))) {
        next = bsmr.rawReader.readUint().then(function(typeIdLen) {
          var next = Promise.resolve();
          var addTypeId = function() {
            return bsmr.rawReader.readUint().then(function(typeId) {
              bsmr._typeIds.push(typeId);
            });
          };
          for (var i = 0; i < typeIdLen; i++) {
            next = next.then(addTypeId);
          }
          return next;
        });
      }
      if (bsmr._version !== versions.version80 && TypeUtil.hasAny(type)) {
        next = next.then(function() {
            return bsmr.rawReader.readUint().then(function(anyLensLen) {
              var next = Promise.resolve();
              var addAnyLen = function() {
                return bsmr.rawReader.readUint().then(function(len) {
                  bsmr._anyLens.push(len);
                });
              };
              for (var i = 0; i < anyLensLen; i++) {
                next = next.then(addAnyLen);
              }
              return next;
          });
        });
      }
      return next.then(function() {
        if (TypeUtil.shouldSendLength(type)) {
          return bsmr.rawReader.readUint().then(function() {
            return type;
          });
        }
        return type;
      });
    });
  }, function(err) {
    // Hopefully this is an eof.
    return null;
  });
};

},{"../gen-vdl/v.io/v23/vom":58,"../vdl/type-util.js":144,"./versions.js":172}],159:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Represents a write stream of VOM messages backed by a byte
 * array.
 * @private
 */

module.exports = ByteMessageWriter;

var RawVomWriter = require('./raw-vom-writer.js');
var versions = require('./versions.js');
var wiretype = require('../gen-vdl/v.io/v23/vom');

/**
 * Create a VOM message writer that writes to a byte array.
 * @constructor
 * @param {number} version vom version (e.g. 0x80, 0x81, ...)
 * @memberof module:vanadium.vom
 */
function ByteMessageWriter(version) {
  if (!version) {
    version = versions.defaultVersion;
  }
  this._version = version;
  this.rawWriter = new RawVomWriter();
  this.rawWriter._writeRawBytes(new Uint8Array([version]));
}

/**
 * Write a value message.
 * @private
 * @param {number} typeId The type ID of the message.
 * @param {boolean} sendLength true if the message length should be sent in the
 * header, false otherwise.
 * @param {boolean} hasAny true if the message contains an any, false otherwise.
 * @param {boolean} hasTypeObject true if the message contains a type object,
 * false otherwise.
 * @param {Array.<number>} typeIds a list of referenced type ids, in order.
 * @param {Uint8Array} message The body of the message.
 */
ByteMessageWriter.prototype.writeValueMessage = function(
  typeId, sendLength, hasAny, hasTypeObject, typeIds, anyLens, message) {
  if (typeId <= 0) {
    throw new Error('Type ids should be positive integers.');
  }
  this.rawWriter.writeInt(typeId);
  var i;
  if (this._version !== versions.version80 && (hasAny || hasTypeObject)) {
    this.rawWriter.writeUint(typeIds.length);
    for (i = 0; i < typeIds.length; i++) {
      this.rawWriter.writeUint(typeIds[i]);
    }
  }
  if (this._version !== versions.version80 && hasAny) {
    this.rawWriter.writeUint(anyLens.length);
    for (i = 0; i < anyLens.length; i++) {
      this.rawWriter.writeUint(anyLens[i]);
    }
  }
  if (sendLength) {
    this.rawWriter.writeUint(message.length);
  }
  this.rawWriter._writeRawBytes(message);
};

/**
 * Write a type message.
 * @private
 * @param {number} typeId The type ID to define.
 * @param {Uint8Array} message The body of the type description message.
 * @param {bool} isIncomplete true if the type message is incomplete and
 * depends on further types being sent.
 */
ByteMessageWriter.prototype.writeTypeMessage = function(
  typeId, message, isIncomplete) {
  if (typeId <= 0) {
    throw new Error('Type ids should be positive integers.');
  }
  if (this._version !== versions.version80 && isIncomplete) {
    this.rawWriter.writeControlByte(wiretype.WireCtrlTypeIncomplete);
  }
  this.rawWriter.writeInt(-typeId);
  this.rawWriter.writeUint(message.length);
  this.rawWriter._writeRawBytes(message);
};

/**
 * Get the written bytes.
 * @return {Uint8Array} The bytes that were written.
 */
ByteMessageWriter.prototype.getBytes = function() {
  return this.rawWriter.getBytes();
};

ByteMessageWriter.prototype.reset = function() {
  this.rawWriter = new RawVomWriter();
};

},{"../gen-vdl/v.io/v23/vom":58,"./raw-vom-writer.js":168,"./versions.js":172}],160:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Represents a read stream of VOM messages backed by a byte
 * array.
 * @private
 */

module.exports = ByteStreamMessageReader;

var ByteMessageReader = require('./byte-message-reader.js');
var StreamReader = require('./stream-reader.js');
var RawVomReader = require('./raw-vom-reader.js');
var inherits = require('inherits');

/**
 * Create a VOM message reader backed by a byte stream.
 * @constructor
 * @memberof module:vanadium.vom
 */
function ByteStreamMessageReader() {
  this._streamReader = new StreamReader();
  ByteMessageReader.call(this, new RawVomReader(this._streamReader));
}

inherits(ByteStreamMessageReader, ByteMessageReader);

ByteStreamMessageReader.prototype.addBytes = function(bytes) {
  this._streamReader.addBytes(bytes);
};

},{"./byte-message-reader.js":158,"./raw-vom-reader.js":167,"./stream-reader.js":169,"inherits":32}],161:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var ByteArrayMessageReader = require('./byte-array-message-reader');
var Decoder = require('./decoder');

module.exports = decode;
/**
 * Decode VOM-decodes the given data into the provided value using a new
 * instance of a VOM decoder.
 *
 * @param  {Uint8Array} bytes    VOM-encoded bytes
 * @param  {boolean} [deepWrap=false] true if the values on the object should
 * remain wrapped with type information deeply, false (default) to strip
 * deep type information and obtain a more usage-friendly value
 * @param {module:vanadium.vom.TypeDecoder} typeDecoder The type decoder to
 * use.  This can be null.
 * @param  {module:vanadium.vom.decode~cb} cb
 * @return {Promise<*>} decoded value
 * @memberof module:vanadium.vom
 */
function decode(bytes, deepWrap, typeDecoder, cb) {
  var reader = new ByteArrayMessageReader(bytes);
  var decoder = new Decoder(reader, deepWrap, typeDecoder);
  return decoder.decode(cb);
}

},{"./byte-array-message-reader":157,"./decoder":162}],162:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Represents a VOM decoder.
 * @private
 */

module.exports = Decoder;

var canonicalize = require('../vdl/canonicalize.js');
var TypeDecoder = require('./type-decoder.js');
var kind = require('../vdl/kind.js');
var Registry = require('../vdl/registry.js');
var types = require('../vdl/types.js');
var util = require('../vdl/util.js');
var unwrap = require('../vdl/type-util').unwrap;
var wiretype = require('../gen-vdl/v.io/v23/vom');
var nativeTypeRegistry = require('../vdl/native-type-registry');
var Deferred = require('../lib/deferred');
var Promise = require('../lib/promise');
var TaskSequence = require('../lib/task-sequence');
var promiseFor = require('../lib/async-helper').promiseFor;
var promiseWhile = require('../lib/async-helper').promiseWhile;
var versions = require('./versions');

var endByte = unwrap(wiretype.WireCtrlEnd);
var nilByte = unwrap(wiretype.WireCtrlNil);

/**
 * Create a decoder to read objects from the provided message reader.
 * Decode has the option of returning a deeply-wrapped object, or an object only
 * wrapped at the top-level.
 * @param {module:vanadium.vom.ByteArrayMessageReader} reader The message
 * reader.
 * @param {boolean=} deepWrap Whether to deeply wrap. Defaults to false.
 * @param {module:vanadium.vom.TypeDecoder} typeDecoder The type decoder to
 * use.  This can be null.
 * @memberof module:vanadium.vom
 * @constructor
 */
function Decoder(messageReader, deepWrap, typeDecoder) {
  this._messageReader = messageReader;
  this._typeDecoder = typeDecoder || new TypeDecoder();
  this._deepWrap = false;
  this._tasks = new TaskSequence();
}

/*
 * TODO(bprosnitz) We will want to be able to decode when we get callbacks.
 * Revisit this API.
 */
/**
 * Decodes the next object off of the message reader.
 * @return {object} The next object or null if no more objects are available.
 */
Decoder.prototype.decode = function(cb) {
  var def = new Deferred(cb);
  var decoder = this;
  this._tasks.addTask(function() {
    return decoder._messageReader.nextMessageType(decoder._typeDecoder).
      then(function(type) {
      if (type === null) {
        return null;
      }
      var reader = decoder._messageReader.rawReader;
      return decoder._decodeValue(type, reader, true);
    }).then(function(v) {
      def.resolve(v);
    }, function(err) {
      def.reject(err);
    });
  });
  return def.promise;
};

Decoder.prototype._decodeValue = function(t, reader, shouldWrap) {
  return this._decodeUnwrappedValue(t, reader).then(function(value) {
    // Special: JSValue should be reduced and returned as a native value.
    if (types.JSVALUE.equals(t)) {
      return canonicalize.reduce(value, types.JSVALUE);
    }

    if (nativeTypeRegistry.hasNativeType(t)) {
      return canonicalize.reduce(value, t);
    }
    // If this value should be wrapped, apply the constructor.
    if (t.kind !== kind.TYPEOBJECT && shouldWrap) {
      var Ctor = Registry.lookupOrCreateConstructor(t);
      if (Ctor.prototype._wrappedType) {
        return new Ctor(value);
      }
      if (value !== null && value !== undefined) {
        Object.defineProperty(value, 'constructor', {
          value: Ctor,
        });
      }
    }
    return value;
  });
};

Decoder.prototype._decodeUnwrappedValue = function(t, reader) {
  switch (t.kind) {
    case kind.BOOL:
      return reader.readBool();
    case kind.BYTE:
      return reader.readByte();
    case kind.UINT16:
    case kind.UINT32:
      return reader.readUint();
    case kind.UINT64:
      return reader.readBigUint();
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
      return reader.readInt();
    case kind.INT64:
      return reader.readBigInt();
    case kind.FLOAT32:
    case kind.FLOAT64:
      return reader.readFloat();
    case kind.COMPLEX64:
    case kind.COMPLEX128:
      return reader.readFloat().then(function(real) {
         return reader.readFloat().then(function(imag) {
           return {
             real: real,
             imag: imag
           };
         });
      });
    case kind.STRING:
      return reader.readString();
    case kind.ENUM:
      return this._decodeEnum(t, reader);
    case kind.LIST:
      return this._decodeList(t, reader);
    case kind.ARRAY:
      return this._decodeArray(t, reader);
    case kind.SET:
      return this._decodeSet(t, reader);
    case kind.MAP:
      return this._decodeMap(t, reader);
    case kind.STRUCT:
      return this._decodeStruct(t, reader);
    case kind.UNION:
      return this._decodeUnion(t, reader);
    case kind.ANY:
      return this._decodeAny(reader);
    case kind.OPTIONAL:
      return this._decodeOptional(t, reader);
    case kind.TYPEOBJECT:
      var decoder = this;
      var typeId;
      return reader.readUint().then(function(tId) {
        var mr = decoder._messageReader;
        if (mr._version === versions.version80) {
          typeId = tId;
        } else {
          typeId = mr._typeIds[tId];
        }
        return decoder._typeDecoder.lookupType(typeId);
      }).then(function(type) {
        if (type === undefined) {
          throw new Error('Undefined type for TYPEOBJECT id ' + typeId);
        }
        return type;
      });

    default:
      return Promise.reject(new Error('Support for decoding kind ' + t.kind +
        ' not yet implemented'));
  }
};

Decoder.prototype._decodeEnum = function(t, reader) {
  return reader.readUint().then(function(index) {
    if (t.labels.length <= index) {
      throw new Error('Invalid enum index ' + index);
    }
    return t.labels[index];
  });
};

Decoder.prototype._decodeList = function(t, reader) {
  var decoder = this;
  return reader.readUint().then(function(len) {
    return decoder._readSequence(t, len, reader);
  });
};

Decoder.prototype._decodeArray = function(t, reader) {
  var decoder = this;
  // Consume the zero length at the beginning of the array.
  return reader.readUint().then(function(b) {
    if (b !== 0) {
      throw new Error('Unexpected length ' + b);
    }
    return decoder._readSequence(t, t.len, reader);
  });
};

Decoder.prototype._readSequence = function(t, len, reader) {
  if (t.elem.kind === kind.BYTE) {
    // Read byte sequences directly into Uint8Arrays.

    // The Uint8Array is created by calling subarray. In node, this means that
    // its buffer points to the whole binary_reader buffer. To fix this, we
    // recreate the Uint8Array here to avoid exposing it.
    return reader._readRawBytes(len).then(function(b) {
      return new Uint8Array(b);
    });
  }

  var arr = new Array(len);
  var i = 0;
  var decoder = this;
  return promiseFor(len, function() {
    return decoder._decodeValue(t.elem, reader, false).then(function(val) {
      arr[i] = val;
      i++;
    });
  }).then(function() {
    return arr;
  });
};

Decoder.prototype._decodeSet = function(t, reader) {
  var decoder = this;
  var s = new Set();
  return reader.readUint().then(function(len) {
    return promiseFor(len, function() {
      return decoder._decodeValue(t.key, reader, false).then(function(key) {
        s.add(key);
      });
    });
  }).then(function() {
    return s;
  });
};

Decoder.prototype._decodeMap = function(t, reader) {
  var decoder = this;
  return reader.readUint().then(function(len) {
    var m = new Map();
    var i = 0;
    if (len > 0) {
      return decoder._decodeValue(t.key, reader, false).then(handleKey);
    }
    return m;

    function handleKey(key) {
      return decoder._decodeValue(t.elem, reader, false).then(function(value) {
        m.set(key, value);
        i++;
        if (i < len) {
          return decoder._decodeValue(t.key, reader, false).then(handleKey);
        }
        return m;
      });
    }
  });
};

Decoder.prototype._decodeStruct = function(t, reader) {
  var decoder = this;
  var Ctor = Registry.lookupOrCreateConstructor(t);
  var obj = Object.create(Ctor.prototype);

  return promiseWhile(notEndByte, readField).then(function() {
    return obj;
  }).then(function(obj) {
    t.fields.forEach(function(field) {
      var name = util.uncapitalize(field.name);
      if (!obj.hasOwnProperty(name)) {
        obj[name] = unwrap(canonicalize.zero(field.type));
      }
    });
    return obj;
  });
  function notEndByte() {
    return reader.tryReadControlByte().then(function(ctrl) {
      if (ctrl === endByte) {
        return false;
      }

      if (ctrl) {
        throw new Error('Unexpected control byte ' + ctrl);
      }
      return true;
    });
  }
  function readField() {
    var name = '';
    return reader.readUint().then(function(nextIndex) {
      if (t.fields.length <= nextIndex) {
        throw new Error('Struct index ' + nextIndex + ' out of bounds');
      }
      var field = t.fields[nextIndex];
      name = util.uncapitalize(field.name);
      return decoder._decodeValue(field.type, reader, false);
    }).then(function(val) {
      obj[name] = val;
    });
  }
};

Decoder.prototype._decodeOptional = function(t, reader) {
  var decoder = this;
  return reader.peekByte().then(function(isNil) {
    if (isNil === nilByte) {
      // We don't have to wait for the read to finish.
      reader.tryReadControlByte();
      return null;
    }
    return decoder._decodeValue(t.elem, reader, false);
  });
};

Decoder.prototype._decodeAny = function(reader) {
  var decoder = this;
  return reader.tryReadControlByte().then(function(ctrl) {
    if (ctrl === nilByte) {
      return null;
    }

    if (ctrl) {
      throw new Error('Unexpected control byte ' + ctrl);
    }
    var typeId;
    return reader.readUint().then(function(tId) {
      var mr = decoder._messageReader;
      if (mr._version === versions.version80) {
        typeId = tId;
      } else {
        typeId = mr._typeIds[tId];
      }
    }).then(function() {
      var mr = decoder._messageReader;
      if (mr._version !== versions.version80) {
        return reader.readUint().then(function(anyLenIndex) {
          // ignore since we don't have raw bytes in js.
        });
      }
    }).then(function() {
      return decoder._typeDecoder.lookupType(typeId);
    }).then(function(type) {
      if (type === undefined) {
        throw new Error('Undefined typeid ' + typeId);
      }
      return decoder._decodeValue(type, reader, true);
    });
  });
};

Decoder.prototype._decodeUnion = function(t, reader) {
  var decoder = this;
  var field;
  // Find the Union field that was set and decode its value.
  return reader.readUint().then(function(fieldIndex) {
    if (t.fields.length <= fieldIndex) {
      throw new Error('Union index ' + fieldIndex + ' out of bounds');
    }
    field = t.fields[fieldIndex];
    return decoder._decodeValue(field.type, reader, false);
  }).then(function(val) {
    // Return the Union with a single field set to its decoded value.
    var Ctor = Registry.lookupOrCreateConstructor(t);
    var obj = Object.create(Ctor.prototype);
    obj[util.uncapitalize(field.name)] = val;
    return obj;
  });
};

},{"../gen-vdl/v.io/v23/vom":58,"../lib/async-helper":68,"../lib/deferred":69,"../lib/promise":73,"../lib/task-sequence":76,"../vdl/canonicalize.js":126,"../vdl/kind.js":136,"../vdl/native-type-registry":137,"../vdl/registry.js":140,"../vdl/type-util":144,"../vdl/types.js":146,"../vdl/util.js":147,"./type-decoder.js":170,"./versions":172}],163:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var ByteMessageWriter = require('./byte-message-writer');
var Encoder = require('./encoder');

module.exports = encode;
/**
 * Encode encodes the provided value using a new instance of an Encoder.
 * @param  {*} v value to encode
 * @param {module:vanadium.vom.Type=} t optional type to convert to
 * @param {module:vanadium.vom.TypeEncoder} te optional type encoder to
 * use.
 * @param {number} version vom version (e.g. 0x80, 0x81, ...)
 * @return {Uint8Array} encoded bytes
 * @memberof module:vanadium.vom
 */
function encode(v, t, te, version) {
  var writer = new ByteMessageWriter(version);
  var encoder = new Encoder(writer, te, version);
  encoder.encode(v, t);
  return writer.getBytes();
}

},{"./byte-message-writer":159,"./encoder":164}],164:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Represents a VOM encoder.
 * @private
 */

module.exports = Encoder;

var TypeEncoder = require('./type-encoder.js');
var util = require('../vdl/util.js');
var typeUtil = require('../vdl/type-util.js');
var RawVomWriter = require('./raw-vom-writer.js');
var kind = require('../vdl/kind.js');
var canonicalize = require('../vdl/canonicalize.js');
var stringify = require('../vdl/stringify.js');
var guessType = require('../vdl/guess-type.js');
var BigInt = require('../vdl/big-int');
var BootstrapTypes = require('./bootstrap-types');

var unwrap = require('../vdl/type-util').unwrap;
var wiretype = require('../gen-vdl/v.io/v23/vom');

var endByte = unwrap(wiretype.WireCtrlEnd);
var nilByte = unwrap(wiretype.WireCtrlNil);

var versions = require('./versions.js');

require('../vdl/es6-shim');

/**
 * Create an encoder that manages the transmission and marshaling of typed
 * values to the other side of a connection.
 * @param {module:vanadium.vom.ByteMessageWriter} messageWriter The
 * message writer to write to.
 * @param {module:vanadim.vom.TypeEncoder} typeEncoder If set, the passed
 * in type encoder will be used and the type messages will not appear in
 * messageWriter's output.
 * @param {number} version vom version (e.g. 0x80, 0x81, ...)
 * @constructor
 * @memberof module:vanadium.vom
 */
function Encoder(messageWriter, typeEncoder, version) {
  this._messageWriter = messageWriter;
  if (typeEncoder) {
    this._typeEncoder = typeEncoder;
  } else {
    this._typeEncoder = new TypeEncoder(messageWriter);
  }
  if (!version) {
    version = versions.defaultVersion;
  }
  this._version = version;
}

/**
 * Encodes a value.
 * @param {*} val The value to encode
 * @param {module:vanadium.vdl.Type} type The type of the value.
 */
Encoder.prototype.encode = function(val, type) {
  if (type === undefined) {
    type = guessType(val);
  }

  // Canonicalize and validate the value. This prepares the value for encoding.
  val = canonicalize.fill(val, type);

  var typeId = this._typeEncoder.encodeType(type);
  this._typeIds = [];
  this._anyLens = [];
  var writer = new RawVomWriter(this._version);
  this._encodeValue(val, type, writer, false);
  this._messageWriter.writeValueMessage(typeId,
    typeUtil.shouldSendLength(type), typeUtil.hasAny(type),
    typeUtil.hasTypeObject(type), this._typeIds, this._anyLens,
    writer.getBytes());
};

Encoder.prototype._encodeValue = function(v, t, writer, omitEmpty) {
  v = typeUtil.unwrap(v);

  switch (t.kind) {
    case kind.BOOL:
      if (!v && omitEmpty) {
        return false;
      }
      writer.writeBool(v);
      return true;
    case kind.BYTE:
      if (!v && omitEmpty) {
        return false;
      }
      writer.writeByte(v);
      return true;
    case kind.UINT16:
    case kind.UINT32:
    case kind.UINT64:
      if (!v && omitEmpty) {
        return false;
      }
      if ((v instanceof BigInt) && omitEmpty && v._sign === 0) {
        return false;
      }
      writer.writeUint(v);
      return true;
    case kind.INT8:
      if (this._version === versions.version80) {
        throw new Error('int8 is not supported in VOM version 0x80');
      } // jshint ignore:line
    case kind.INT16:
    case kind.INT32:
    case kind.INT64:
      if (!v && omitEmpty) {
        return false;
      }
      if ((v instanceof BigInt) && omitEmpty && v._sign === 0) {
        return false;
      }
      writer.writeInt(v);
      return true;
    case kind.FLOAT32:
    case kind.FLOAT64:
      if (!v && omitEmpty) {
        return false;
      }
      writer.writeFloat(v);
      return true;
    case kind.COMPLEX64:
    case kind.COMPLEX128:
      if (typeof v === 'object') {
        if (v.real === 0 && v.imag === 0 && omitEmpty) {
          return false;
        }
        writer.writeFloat(v.real);
        writer.writeFloat(v.imag);
        return true;
      } else if (typeof v === 'number' && omitEmpty) {
        if (v === 0) {
          return false;
        }
        writer.writeFloat(v);
        writer.writeFloat(0);
        return true;
      }
      return false;
    case kind.STRING:
      if (v === '' && omitEmpty) {
        return false;
      }
      writer.writeString(v);
      return true;
    case kind.ENUM:
      return this._encodeEnum(v, t, writer, omitEmpty);
    case kind.LIST:
      return this._encodeList(v, t, writer, omitEmpty);
    case kind.ARRAY:
      return this._encodeArray(v, t, writer, omitEmpty);
    case kind.SET:
      return this._encodeSet(v, t, writer, omitEmpty);
    case kind.MAP:
      return this._encodeMap(v, t, writer, omitEmpty);
    case kind.STRUCT:
      return this._encodeStruct(v, t, writer, omitEmpty);
    case kind.UNION:
      return this._encodeUnion(v, t, writer, omitEmpty);
    case kind.ANY:
      return this._encodeAny(v, writer, omitEmpty);
    case kind.OPTIONAL:
      return this._encodeOptional(v, t, writer, omitEmpty);
    case kind.TYPEOBJECT:
      var typeId = this._typeEncoder.encodeType(v);
      if (typeId === BootstrapTypes.definitions.ANY.id && omitEmpty) {
        return false;
      }
      if (this._version === versions.version80) {
        writer.writeUint(typeId);
      } else {
        writer.writeUint(this._addTypeId(typeId));
      }
      return true;
    default:
      throw new Error('Unknown kind ' + t.kind);
  }
};

Encoder.prototype._encodeEnum = function(v, t, writer, omitEmpty) {
  var labelIndex = t.labels.indexOf(v);
  if (omitEmpty && labelIndex === 0) {
    return false;
  }
  writer.writeUint(labelIndex);
  return true;
};

Encoder.prototype._encodeList = function(v, t, writer, omitEmpty) {
  if (v.length === 0 && omitEmpty) {
    return false;
  }
  writer.writeUint(v.length);
  this._writeSequence(v, t, writer);
  return true;
};

Encoder.prototype._encodeArray = function(v, t, writer) {
  writer.writeUint(0);
  this._writeSequence(v, t, writer);
  return true;
};

Encoder.prototype._encodeSet = function(v, t, writer, omitEmpty) {
  if (v.size === 0 && omitEmpty) {
    return false;
  }
  writer.writeUint(v.size);
  v.forEach(function(value, key) {
    this._encodeValue(key, t.key, writer);
  }, this);
  return true;
};

Encoder.prototype._encodeMap = function(v, t, writer, omitEmpty) {
  if (v.size === 0 && omitEmpty) {
    return false;
  }
  writer.writeUint(v.size);
  v.forEach(function(value, key) {
    this._encodeValue(key, t.key, writer);
    this._encodeValue(value, t.elem, writer);
  }, this);
  return true;
};

Encoder.prototype._encodeStruct = function(v, t, writer, omitEmpty) {
  // Encode the fields.
  var hasWrittenFields = false;
  t.fields.forEach(function(fieldDesc, fieldIndex) {
    var pos = writer.getPos();
    writer.writeUint(fieldIndex);
    var fieldVal = v[util.uncapitalize(fieldDesc.name)];
    var valueWritten = this._encodeValue(fieldVal, fieldDesc.type, writer,
                                         true);
    if (!valueWritten) {
      writer.seekBack(pos);
    } else {
      hasWrittenFields = true;
    }
  }, this);
  if (omitEmpty && !hasWrittenFields) {
    return false;
  }
  writer.writeControlByte(endByte);
  return true;
};

Encoder.prototype._writeSequence = function(v, t, writer) {
  if (t.elem.kind === kind.BYTE) {
    // Byte sequences can be copied directly from the input Uint8Array.
    writer._writeRawBytes(v);
    return;
  }

  for (var i = 0; i < v.length; i++) {
    var elem = v[i];
    var elemType = t.elem;
    this._encodeValue(elem, elemType, writer);
  }
};

Encoder.prototype._encodeOptional = function(v, t, writer, omitEmpty) {
  if (v === null || v === undefined) {
    if (omitEmpty) {
      return false;
    }
    writer.writeControlByte(nilByte);
    return true;
  }
  this._encodeValue(v, t.elem, writer, false);
  return true;
};

Encoder.prototype._encodeAny = function(v, writer, omitEmpty) {
  if (v === null || v === undefined) {
    if (omitEmpty) {
      return false;
    }
    writer.writeControlByte(nilByte);
    return true;
  }
  var t = guessType(v);
  var typeId = this._typeEncoder.encodeType(t);
  var anyLenIndex;
  var startPos;
  if (this._version === versions.version80) {
    writer.writeUint(typeId);
  } else {
    writer.writeUint(this._addTypeId(typeId));
    anyLenIndex = this._nextAnyLenIndex();
    writer.writeUint(anyLenIndex);
    startPos = writer.getPos();
  }
  this._encodeValue(v, t, writer, false);
  if (this._version !== versions.version80) {
    var endPos = writer.getPos();
    this._anyLens[anyLenIndex] = endPos - startPos;
  }
  return true;
};

Encoder.prototype._encodeUnion = function(v, t, writer, omitEmpty) {
  for (var i = 0; i < t.fields.length; i++) {
    var key = t.fields[i].name;
    var lowerKey = util.uncapitalize(key);
    if (v.hasOwnProperty(lowerKey) && v[lowerKey] !== undefined) {
      var pos = writer.getPos();
      writer.writeUint(i);
      // We can only omit empty values if it is the first field in the
      // union.  If it is the second or later field, it always has to
      // be emitted.
      omitEmpty = omitEmpty && i === 0;
      var encoded = this._encodeValue(v[lowerKey], t.fields[i].type, writer,
                                      omitEmpty);

      if (!encoded) {
        writer.seekBack(pos);
        return false;
      }
      return true;
    }
  }
  throw new Error('Union did not encode properly. Received: ' + stringify(v));
};

Encoder.prototype._addTypeId = function(typeId) {
  var index = this._typeIds.indexOf(typeId);
  if (index !== -1) {
    return index;
  }
  index = this._typeIds.length;
  this._typeIds.push(typeId);
  return index;
};

Encoder.prototype._nextAnyLenIndex = function() {
  var index = this._anyLens.length;
  this._anyLens.push(0);
  return index;
};

},{"../gen-vdl/v.io/v23/vom":58,"../vdl/big-int":124,"../vdl/canonicalize.js":126,"../vdl/es6-shim":131,"../vdl/guess-type.js":132,"../vdl/kind.js":136,"../vdl/stringify.js":141,"../vdl/type-util":144,"../vdl/type-util.js":144,"../vdl/util.js":147,"./bootstrap-types":156,"./raw-vom-writer.js":168,"./type-encoder.js":171,"./versions.js":172}],165:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
/**
 * @summary Namespace vom implements Vanadium Object Marshaling, a serialization
 * protocol.  Vom is used in Vanadium to enable interchange of user-defined data
 * structures across networks, languages and storage systems.
 * @description
 * <p> Namespace vom implements Vanadium Object Marshaling, a serialization
 * protocol.</p>
 * <p>For the concept doc see
 * {@link https://vanadium.github.io/concepts/rpc.html#vom}
 * </p>
 * <p>Vom is used in Vanadium to enable interchange of user-defined data
 * structures across networks, languages and storage systems.</p>
 *
 * <p>VOM supports the same types and compatibility rules supported by
 * [VDL]{@link module:vanadium.vdl}.  It is a self-describing wire
 * format.</p>
 */
module.exports = {
  ByteArrayMessageReader: require('./byte-array-message-reader'),
  ByteMessageWriter: require('./byte-message-writer'),
  Encoder: require('./encoder'),
  Decoder: require('./decoder'),
  encode: require('./encode'),
  decode: require('./decode'),
  TypeDecoder: require('./type-decoder'),
  TypeEncoder: require('./type-encoder')
};

require('./native-types'); // Register standard native types.

},{"./byte-array-message-reader":157,"./byte-message-writer":159,"./decode":161,"./decoder":162,"./encode":163,"./encoder":164,"./native-types":166,"./type-decoder":170,"./type-encoder":171}],166:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var registry = require('../vdl/native-type-registry');
var vdl = require('../vdl');
var Time = require('../gen-vdl/v.io/v23/vdlroot/time').Time;
var typeutil = require('../vdl/type-util');

var timeType = Time.prototype._type;
registry.registerFromNativeValue(Date, toDateWireValue, timeType);
registry.registerFromWireValue(timeType, fromDateWireValue);

// The javascript epoch is 1970, but in VDL it's the year 1.
var nativeEpochConversion = Math.floor(Date.parse('0001-01-01')/1000);
var epochConversion = vdl.BigInt.fromNativeNumber(nativeEpochConversion);

function fromDateWireValue(v) {
  v = v || {};
  if (v instanceof Date) {
    return v;
  }
  var seconds;
  if (v.seconds) {
    var unwrapped = typeutil.unwrap(v.seconds);
    if (unwrapped instanceof vdl.BigInt) {
      // TODO(bprosnitz) We should always have big int once we canonicalize
      // before calling this.
      seconds = unwrapped.add(epochConversion).toNativeNumberApprox();
    } else {
      seconds = unwrapped + nativeEpochConversion;
    }
  } else {
    seconds = nativeEpochConversion;
  }
  // TODO(bprosnitz) Remove the undefined cases because they
  // shouldn't be required after canonicalized is changed to canonicalized the
  // input before passing to this function.
  var nanos = typeutil.unwrap(v.nanos) || 0;
  var epochInMillis = seconds * 1000 +
    nanos / 1000000;

  var out = new Date(epochInMillis);
  return out;
}

function toDateWireValue(v) {
  if (v instanceof Date) {
    var time = v ? v.getTime() : 0;
    var jssecs = Math.floor(time / 1000);
    var nanos = (time - jssecs * 1000) * 1000000;
    var vdlsecs = vdl.BigInt.fromNativeNumber(jssecs).subtract(epochConversion);
    return new Time({seconds: vdlsecs, nanos: nanos}, true);
  }
  return v;
}

},{"../gen-vdl/v.io/v23/vdlroot/time":56,"../vdl":133,"../vdl/native-type-registry":137,"../vdl/type-util":144}],167:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/*global escape: true */
/**
 * @fileoverview Definition of RawVomReader.
 * @private
 */

module.exports = RawVomReader;

var BigInt = require('../vdl/big-int.js');
var BinaryReader = require('./binary-reader.js');
var ByteUtil = require('../vdl/byte-util.js');
var versions = require('./versions.js');

/**
 * RawVomReader reads VOM primitive values (numbers, strings, bools) from a
 * provided Uint8Array.
 * @private
 * @param {Uint8Array|StreamReader} arr The array to read from.
 * @param {number} version vom version (e.g. 0x80, 0x81, ...)
 * @constructor
 */
function RawVomReader(arr) {
  if (arr instanceof Uint8Array) {
    this._reader = new BinaryReader(arr);
  } else {
    this._reader = arr;
  }
}

/**
 * Reads a uint as a BigInt.
 * @return {Promise<BigInt>} The BigUint that was read.
 */
RawVomReader.prototype.readBigUint = function() {
  var reader = this;
  return this._reader.readByte().then(function(firstByte) {
    if (firstByte <= 0x7f) {
      if (firstByte === 0) {
        return new BigInt(0, new Uint8Array(0));
      }
      return new BigInt(1, new Uint8Array([firstByte]));
    }

    var numBytes = 0x100 - firstByte;
    if (numBytes > 8 || numBytes < 1) {
      throw new Error('Invalid size ' + numBytes);
    }

    return reader._reader.readByteArray(numBytes).then(function(uintBytes) {
      return new BigInt(1, uintBytes);
    });
  });
};

/**
 * Returns a control byte if the next byte is a control byte.
 * @returns {Promise<number>} a control byte if there is one, null if there
 * is no control byte.
 */
RawVomReader.prototype.tryReadControlByte = function() {
  var reader = this;
  return this.peekByte().then(function(firstByte) {
    if (firstByte === null) {
      return null;
    }

    if (firstByte > 0x7f && firstByte <= 0xef) {
      return reader._reader.readByte();
    }
    return null;
  });
};

/**
 * Reads a BigInt.
 * @return {Promise<BigInt>} The BigInt that was read.
 */
RawVomReader.prototype.readBigInt = function() {
  return this.readBigUint().then(function(uint) {
    var bytes = uint.getUintBytes();
    var sign;
    if (uint.getSign() === 0) {
      sign = 0;
    } else if (bytes.length > 0 && (bytes[bytes.length - 1] & 0x01) !== 0) {
      sign = -1;
    } else {
      sign = 1;
    }
    bytes = ByteUtil.shiftRightOne(bytes);
    if (sign === -1) {
      bytes = ByteUtil.increment(bytes);
    }
    return new BigInt(sign, bytes);
  });
};

/**
 * Reads a unsigned integer as a native JavaScript number.
 * @return {Promise<number>} The uint that was read.
 */
RawVomReader.prototype.readUint = function() {
  return this.readBigUint().then(function(uint) {
    return uint.toNativeNumber();
  });
};

/**
 * Reads a integer as a native JavaScript number.
 * @return {Promise<number>} The int that was read.
 */
RawVomReader.prototype.readInt = function() {
  return this.readBigInt().then(function(uint) {
    return uint.toNativeNumber();
  });
};


/**
 * Reads a float as a native JavaScript number.
 * @return {Promise<number>} The float that was read.
 */
RawVomReader.prototype.readFloat = function() {
  return this.readBigUint().then(function (bigInt) {
    var uintBytes = bigInt.getUintBytes();
    var arr = new Uint8Array(8);
    arr.set(uintBytes, arr.length - uintBytes.length);
    var view = new DataView(arr.buffer);
    return view.getFloat64(0, true);
  });
};

/**
 * Reads a string.
 * @return {Promise<string>} The string that was read.
 */
RawVomReader.prototype.readString = function() {
  var reader = this;
  return this.readUint().then(function(length) {
    return reader._reader.readByteArray(length);
   }).then(function(bytes) {
     var str = '';
     for (var i = 0; i < bytes.length; i++) {
       str += String.fromCharCode(bytes[i]);
     }
     return decodeURIComponent(escape(str));
   });
};

/**
 * Reads a boolean.
 * @return {Promise<boolean>} The boolean that was read.
 */
RawVomReader.prototype.readBool = function() {
  return this.readByte().then(function(b) {
    if (b === 1) {
      return true;
    } else if (b === 0) {
      return false;
    }

    throw new Error('Invalid boolean byte ' + b);
  });
};

/**
 * Reads a single VOM byte.
 * @return {Promise<byte>} The byte that was read.
 */
RawVomReader.prototype.readByte = function() {
  var rawReader = this;
  return this._version.then(function (version) {
    if (version === versions.version80) {
      return rawReader._reader.readByte();
    } else {
      return rawReader.readUint();
    }
  });
};

/**
 * Reads a single VOM byte.
 * @return {Promise<byte>} The byte that was read.
 */
RawVomReader.prototype.readVersionByte = function() {
    this._version = this._reader.readByte();
    return this._version;
};

/**
 * Reads a single VOM byte without advancing the reader
 * @return {Promise<number>} The byte that was read.
 */
RawVomReader.prototype.peekByte = function() {
  // NOTE: this reads a byte rather than a uint because it is used
  // for checking for flags.
  return this._reader.peekByte();
};

/**
 * Reads raw bytes.
 * @param {number} amt The number of bytes to read.
 * @return {Promise<Uint8Array>} The bytes that were read.
 */
RawVomReader.prototype._readRawBytes = function(amt) {
  return this._reader.readByteArray(amt);
};

RawVomReader.prototype.hasData = function() {
  return this._reader.hasData();
};

},{"../vdl/big-int.js":124,"../vdl/byte-util.js":125,"./binary-reader.js":154,"./versions.js":172}],168:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/*global unescape: true*/
/**
 * @fileoverview Definition of RawVomReader.
 * @private
 */

module.exports = RawVomWriter;

var BigInt = require('../vdl/big-int.js');
var BinaryWriter = require('./binary-writer.js');
var ByteUtil = require('../vdl/byte-util.js');
var versions = require('./versions.js');

/**
 * RawVomWriter writes VOM primitive values (numbers, strings, bools) to a
 * buffer.
 * @param {number} version vom version (e.g. 0x80, 0x81, ...)
 * @constructor
 * @private
 */
function RawVomWriter(version) {
  this._writer = new BinaryWriter();
  if (!version) {
    version = versions.defaultVersion;
  }
  this._version = version;
}

/**
 * Writes a BigInt as a VOM uint.
 * The BigInt must be non-negative.
 * @param {BigInt} v The value
 */
RawVomWriter.prototype._writeBigUint = function(v) {
  if (v.getSign() === -1) {
    throw new Error('Cannot write negative uint');
  }
  if (v.getSign() === 0) {
    this._writer.writeByte(0);
    return;
  }
  if (v.getUintBytes().length > 1 || v.getUintBytes()[0] > 0x7f) {
    this._writer.writeByte(0x100 - v.getUintBytes().length);
  }
  this._writer.writeByteArray(v.getUintBytes());
};

/**
 * Writes a BigInt as a VOM int.
 * @param {BigInt} v The value
 */
RawVomWriter.prototype._writeBigInt = function(v) {
  var copy = new Uint8Array(v.getUintBytes());
  if (v.getSign() === -1) {
    copy = ByteUtil.decrement(copy);
    copy = ByteUtil.shiftLeftOne(copy);
    copy[copy.length - 1] = copy[copy.length - 1] | 0x01;
  } else {
    copy = ByteUtil.shiftLeftOne(copy);
  }
  this._writeBigUint(new BigInt(Math.abs(v.getSign()), copy));
};

/**
 * Writes a value as a VOM uint.
 * @param {number | BigInt} v The value.
 */
RawVomWriter.prototype.writeUint = function(v) {
  if (typeof v === 'number') {
    v = BigInt.fromNativeNumber(v);
  }
  this._writeBigUint(v);
};

/**
 * Writes a value as a VOM int.
 * @param {number | BigInt} v The value.
 */
RawVomWriter.prototype.writeInt = function(v) {
  if (typeof v === 'number') {
    v = BigInt.fromNativeNumber(v);
  }
  this._writeBigInt(v);
};

/**
 * Writes a value as a VOM float.
 * @param {number | BigInt} v The value.
 */
RawVomWriter.prototype.writeFloat = function(v) {
  if (typeof v === 'object') {
    // BigInt.
    v = v.toNativeNumber();
  }
  var buf = new ArrayBuffer(8);
  var dataView = new DataView(buf);
  dataView.setFloat64(0, v, true);
  var bytes = new Uint8Array(buf);
  var sign = 1;
  if (ByteUtil.emptyOrAllZero(bytes)) {
    sign = 0;
  }
  this._writeBigUint(new BigInt(sign, bytes));
};

/**
 * Writes a VOM string.
 * @param {string} v The string.
 */
RawVomWriter.prototype.writeString = function(v) {
  var utf8String = unescape(encodeURIComponent(v));
  this.writeUint(utf8String.length);
  for (var i = 0; i < utf8String.length; i++) {
    this._writer.writeByte(utf8String.charCodeAt(i));
  }
};

/**
 * Writes a VOM boolean.
 * @param {boolean} v The boolean.
 */
RawVomWriter.prototype.writeBool = function(v) {
  if (v) {
    this.writeByte(1);
  } else {
    this.writeByte(0);
  }
};

/**
 * Writes a single VOM byte.
 * This may be written as a uint so that byte flags can be put in its place.
 * (byte lists are not written with this function but rather _writeRawBytes).
 * @param {byte} v The byte.
 */
RawVomWriter.prototype.writeByte = function(v) {
  if (this._version === versions.version80) {
    this._writer.writeByte(v);
  } else {
    this.writeUint(v);
  }
};

/**
 * Writes a single VOM byte for a control code.
 * @param {byte} v The byte.
 */
RawVomWriter.prototype.writeControlByte = function(v) {
  this._writer.writeByte(v);
};

/**
 * Write raw bytes.
 * @param {Uint8Array} bytes The byte array to write.
 */
RawVomWriter.prototype._writeRawBytes = function(bytes) {
  this._writer.writeByteArray(bytes);
};

/**
 * Gets the written bytes.
 * @return {Uint8Array} The buffered bytes.
 */
RawVomWriter.prototype.getBytes = function() {
  return new Uint8Array(this._writer.getBytes());
};

/**
 * Gets position of underlying buffer
 * @return {number} position of buffer
 */
RawVomWriter.prototype.getPos = function() {
  return this._writer.getPos();
};


/**
 * Seeks back to a previous position
 * @param {number} pos the new position.
 */
RawVomWriter.prototype.seekBack = function(pos) {
  return this._writer.seekBack(pos);
};

},{"../vdl/big-int.js":124,"../vdl/byte-util.js":125,"./binary-writer.js":155,"./versions.js":172}],169:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var Deferred = require('../lib/deferred');
var byteUtil = require('../vdl/byte-util');
var TaskSequence = require('../lib/task-sequence');

module.exports = StreamReader;

/**
 * StreamReader provides a Reader api over a stream of bytes
 * @private
 * @constructor
 */
function StreamReader() {
  this._bufs = [];
  this._closed = false;
  this._sequence = new TaskSequence();

  this._bytesAvailableDef = new Deferred();
}


/**
 * Adds a set of bytes to the stream
 * @param {Uint8Array} bytes The bytes to add
 */
StreamReader.prototype.addBytes = function(bytes) {
  if (bytes.length === 0) {
    return;
  }
  this._bufs.push(bytes);
  if (this._bytesAvailableDef) {
    this._bytesAvailableDef.resolve();
  }
  this._bytesAvailableDef = null;
};

/**
 * Closes the stream reader, which forces readers to
 * consume all the bytes left.
 */
StreamReader.prototype.close = function() {
  this._closed = true;
  if (this._bytesAvailableDef) {
    this._bytesAvailableDef.resolve();
  }
  this._bytesAvailableDef = null;
};

StreamReader.prototype._waitForData = function() {
  if (this._hasBytes() || this._closed) {
    return Promise.resolve();
  }
  this._bytesAvailableDef = new Deferred();
  return this._bytesAvailableDef.promise;
};

StreamReader.prototype._hasBytes = function() {
  return this._bufs.length > 0;
};

/**
 * Reads a byte from the stream
 * @return {Promise<number>}
 */
StreamReader.prototype.readByte = function() {
  var reader = this;
  var def = new Deferred();
  function readByte() {
    return reader._waitForData().then(function() {
      if (!reader._hasBytes()) {
        return Promise.reject(
          new Error('Failed to read byte, eof is ' + reader._closed));
      }
      var byte = reader._bufs[0][0];
      if (reader._bufs[0].length === 1) {
        reader._bufs.shift();
      } else {
        reader._bufs[0] = reader._bufs[0].subarray(1);
      }
      return byte;
    }).then(function(b) {
      def.resolve(b);
    }, function(err) {
      def.reject(err);
    });
  }
  reader._sequence.addTask(readByte);
  return def.promise;
};

/**
 * Peeks a byte from the stream
 * @return {Promise<number>}
 */
StreamReader.prototype.peekByte = function() {
  var reader = this;
  var def = new Deferred();
  function peekByte() {
    return reader._waitForData().then(function() {
      if (!reader._hasBytes()) {
        return Promise.reject(
          new Error('Failed to read byte, eof is ' + reader._closed));
      }
      return reader._bufs[0][0];
    }).then(function(b) {
      def.resolve(b);
    }, function(err) {
      def.reject(err);
    });
  }
  reader._sequence.addTask(peekByte);
  return def.promise;
};

/**
 * Reads a byte array from the stream
 * @param {number} amt The number to read.
 * @return {Promise<Uint8Array>} A promise that will be resolved
 * with the result.
 */
StreamReader.prototype.readByteArray = function(amt) {
  var reader = this;
  var def = new Deferred();
  var pos = 0;
  var buf = new Uint8Array(amt);
  var bytesNeeded = amt;
  function readByteArray() {
    return reader._waitForData().then(function() {
      var currentBuf = reader._bufs[0];
      while (bytesNeeded > 0 && currentBuf) {
        if (currentBuf.length <= bytesNeeded) {
          // Consume the whole array.
          buf.set(currentBuf, pos);
          pos += currentBuf.length;
          bytesNeeded -= currentBuf.length;
          reader._bufs.shift();
          currentBuf = reader._bufs[0];
        } else {
          buf.set(currentBuf.subarray(0, bytesNeeded), pos);
          pos += bytesNeeded;
          reader._bufs[0] = currentBuf.subarray(bytesNeeded);
          bytesNeeded = 0;
        }
      }

      if (bytesNeeded === 0) {
        return buf;
      }

      if (reader._closed) {
        return Promise.reject(
          new Error('Failed to read ' + amt + 'bytes, eof is true'));
      }
      return readByteArray();
    }).then(function(arr) {
      return def.resolve(arr);
    }, function(err) {
      return def.reject(err);
    });
  }

  this._sequence.addTask(readByteArray);
  return def.promise;
};

StreamReader.prototype.getHexBytes = function() {
  return this._bufs.map(byteUtil.bytes2Hex).join('');
};

},{"../lib/deferred":69,"../lib/task-sequence":76,"../vdl/byte-util":125}],170:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Type decoder handles decoding types from a VOM stream by
 * looking up by id.
 *
 * Definitions:
 * Type / Defined Type - The standard VOM JavaScript type object representation.
 * Partial Type - The type representation off the wire, identical to defined
 * types but child types are described by type ids rather than actual complete
 * type objects.
 *
 * Overview:
 * Type decoders hold a cache of decoded types. Types are read off the wire in
 * defineType() and then lazily converted from partial to defined types when
 * they are needed in lookupType().
 * @private
 */

module.exports = TypeDecoder;

/**
 * Create a TypeDecoder.
 * This holds the set of cached types and assists in decoding.
 * @constructor
 * @private
 */
function TypeDecoder() {
  this._definedTypes = {};
  // Partial types are similar to definedTypes but have type ids for child
  // types rather than fully defined type structures.
  this._partialTypes = {};
  this._waiters = {};
}

var kind = require('../vdl/kind.js');
var Type = require('../vdl/type.js');
var BootstrapTypes = require('./bootstrap-types.js');
var RawVomReader = require('./raw-vom-reader.js');
var unwrap = require('../vdl/type-util').unwrap;
var wiretype = require('../gen-vdl/v.io/v23/vom');
var promiseFor = require('../lib/async-helper').promiseFor;
var promiseWhile = require('../lib/async-helper').promiseWhile;
var Promise = require('../lib/promise');
var Deferred = require('../lib/deferred');

var endByte = unwrap(wiretype.WireCtrlEnd);

TypeDecoder.prototype._tryLookupType = function(typeId) {
  if (typeId < 0) {
    throw new Error('invalid negative type id.');
  }

  var type = BootstrapTypes.idToType(typeId);
  if (type !== undefined) {
    return type;
  }

  return this._definedTypes[typeId];
};

/**
 * Looks up a type in the decoded types cache by id.
 * @param {number} typeId The type id.
 * @return {Promise<Type>} The decoded type or undefined.
 */
TypeDecoder.prototype.lookupType = function(typeId) {
  try {
    var type = this._tryLookupType(typeId);
    if (type) {
      return Promise.resolve(type);
    }
  } catch(e) {
    return Promise.reject(e);
  }
  if (this._partialTypes.hasOwnProperty(typeId)) {
    this._tryBuildPartialType(typeId, this._partialTypes[typeId]);
    return Promise.resolve(this._definedTypes[typeId]);
  }
  this._waiters[typeId] = this._waiters[typeId] || new Deferred();
  return this._waiters[typeId].promise;
};

/**
 * Add a new type definition to the type cache.
 * @param {number} typeId The id of the type.
 * @param {Promise<Uint8Array>} The raw bytes that describe the type structure.
 */
TypeDecoder.prototype.defineType = function(typeId, messageBytes) {
  if (typeId < 0) {
    throw new Error('invalid negative type id ' + typeId + '.');
  }
  if (this._definedTypes[typeId] !== undefined ||
    this._partialTypes[typeId] !== undefined) {
    throw new Error('Cannot redefine type with id ' + typeId);
  }

  // Read the type in and add it to the partial type set.
  var td = this;
  return this._readPartialType(messageBytes).then(function(type) {
    td._partialTypes[typeId] = type;
    // If there was another caller waiting on this partialTypeId,
    // then we fully build the type and wake up all the waiters.
    var def = td._waiters[typeId];
    if (def) {
      try {
        td._tryBuildPartialType(typeId, td._partialTypes[typeId]);
        def.resolve(td._definedTypes[typeId]);
      } catch(e) {
        def.reject(e);
      }
      delete td._waiters[typeId];
    }
  });
};

/**
 * Flattens the type's dependencies into a typeId->(type, partial type) map.
 * @private
 * @throws {Error} If the type's dependencies are not available.
 */
TypeDecoder.prototype._flattenTypeDepGraph = function(typeId, typeDeps) {
  // Already in map?
  if (typeDeps[typeId] !== undefined) {
    return;
  }
  // Already defined?
  if (this._tryLookupType(typeId) !== undefined) {
    return;
  }
  // Allocate a type for the partial type.
  if (!this._partialTypes.hasOwnProperty(typeId)) {
    throw new Error('Type definition with ID ' + typeId +
      ' not received.');
  }
  var partialType = this._partialTypes[typeId];
  typeDeps[typeId] = {
    partialType: partialType,
    type: new Type()
  };

  // Recurse.
  if (partialType.namedTypeId !== undefined) {
    this._flattenTypeDepGraph(partialType.namedTypeId, typeDeps);
  }
  if (partialType.keyTypeId !== undefined) {
    this._flattenTypeDepGraph(partialType.keyTypeId, typeDeps);
  }
  if (partialType.elemTypeId !== undefined) {
    this._flattenTypeDepGraph(partialType.elemTypeId, typeDeps);
  }
  var i;
  if (partialType.typeIds !== undefined) {
    for (i = 0; i < partialType.typeIds.length; i++) {
      this._flattenTypeDepGraph(partialType.typeIds[i], typeDeps);
    }
  }
  if (partialType.fields !== undefined) {
    for (i = 0; i < partialType.fields.length; i++) {
      this._flattenTypeDepGraph(partialType.fields[i].typeId, typeDeps);
    }
  }
};

/**
 * Tries to build a partial type into a type.
 * This has two steps:
 * 1. Allocate type objects for all dependencies
 * 2. Copy the type and replace the type id with the created types.
 * 3. Copy named types and change the name.
 */
TypeDecoder.prototype._tryBuildPartialType = function(typeId) {
  if (!this._partialTypes.hasOwnProperty(typeId)) {
    throw new Error('Type definition with ID ' + typeId +
      ' not received.');
  }
  var partialType = this._partialTypes[typeId];

  var flattenedTypes = {};
  this._flattenTypeDepGraph(typeId, flattenedTypes);

  var self = this;
  var getType = function(id) {
    var type = self._tryLookupType(id);
    if (type !== undefined) {
      return type;
    }
    type = flattenedTypes[id].type;
    if (type !== undefined) {
      return type;
    }
    throw new Error('Type unexpectedly undefined.');
  };

  var id;
  var type;
  var i;
  // All dependencies are ready. Build the type.
  for (id in flattenedTypes) {
    if (!flattenedTypes.hasOwnProperty(id)) {
      continue;
    }
    partialType = flattenedTypes[id].partialType;
    type = flattenedTypes[id].type;

    if (partialType.namedTypeId !== undefined) {
      // Handle named types in a second pass because it involves copying.
      continue;
    }

    type.kind = partialType.kind;
    if (partialType.name !== undefined) {
      type.name = partialType.name;
    }
    if (partialType.labels !== undefined) {
      type.labels = partialType.labels;
    }
    if (partialType.len !== undefined) {
      type.len = partialType.len;
    }

    if (partialType.keyTypeId !== undefined) {
      type.key = getType(partialType.keyTypeId);
    }
    if (partialType.elemTypeId !== undefined) {
      type.elem = getType(partialType.elemTypeId);
    }
    if (partialType.typeIds !== undefined) {
      type.types = new Array(partialType.typeIds.length);
      for (i = 0; i < partialType.typeIds.length; i++) {
        type.types[i] = getType(partialType.typeIds[i]);
      }
    }
    if (partialType.fields !== undefined) {
      type.fields = new Array(partialType.fields.length);
      for (i = 0; i < partialType.fields.length; i++) {
        var partialField = partialType.fields[i];
        type.fields[i] = {
          name: partialField.name,
          type: getType(partialField.typeId)
        };
      }
    }
  }

  // Now handle named types.
  for (id in flattenedTypes) {
    if (flattenedTypes.hasOwnProperty(id)) {
      partialType = flattenedTypes[id].partialType;
      type = flattenedTypes[id].type;

      if (partialType.namedTypeId !== undefined) {
        // Special case for named types.
        var toCopy = getType(partialType.namedTypeId);
        for (var fieldName in toCopy) {
          if (toCopy.hasOwnProperty(fieldName)) {
            type[fieldName] = toCopy[fieldName];
          }
        }
        type.name = partialType.name;
      }
    }
  }

  // Now that the types are all prepared, make them immutable.
  for (id in flattenedTypes) {
    if (flattenedTypes.hasOwnProperty(id)) {
      type = flattenedTypes[id].type;

      // Make the type immutable, setting its _unique string too.
      type.freeze();

      // Define the type.
      this._definedTypes[id] = type;

      // Remove the type from the partial type set.
      delete this._partialTypes[id];
    }
  }
};

/**
 * Reads a type off of the wire.
 * @param {RawVomReader} reader The reader with the data
 * @param {module:vanadium.vdl.kind} kind The kind that is being read.
 * @param {string} wireName The name of the type.  This is used to generate
 * error messages
 * @param {object[]} indexMap An array of options specifying how to read the
 * fields of the type object.  The index in the array is the index in the wire
 * structure for the wire type.  Each object in the array should have a key
 * field which is the name of the field in the wire struct and a fn field with
 * a function that will be called with this set to reader and returns a promise
 * with its value.  For instance:<br>
 * <pre>[{key: 'name', fn: reader.readString)}]</pre>
 * <br>
 * Means the value at index 0 will correspond to the name field and should
 * be read by reader.readString
 * @returns {Promise<object>} A promise with the constructed wire type as the
 * result.
 */
TypeDecoder.prototype._readTypeHelper = function(
  reader, kind, wireName, indexMap) {
  var partialType = {
    name: '',
  };
  if (kind) {
    partialType.kind = kind;
  }

  function notEndByte() {
    return reader.tryReadControlByte().then(function(b) {
      if (b === endByte) {
        return false;
      }

      if (b !== null) {
        return Promise.reject('Unknown control byte ' + b);
      }
      return true;
    });
  }

  function readField() {
    var entry;
    return reader.readUint().then(function(nextIndex) {
      entry = indexMap[nextIndex];
      if (!entry) {
        throw Error('Unexpected index for ' + wireName + ': ' + nextIndex);
      }
      return entry.fn.bind(reader)();
    }).then(function(val) {
      partialType[entry.key] = val;
    });
  }
  return promiseWhile(notEndByte, readField).then(function() {
    return partialType;
  });
};

TypeDecoder.prototype._readNamedType = function(reader) {
  return this._readTypeHelper(reader, null, 'WireNamed', [
    {key: 'name', fn: reader.readString },
    {key: 'namedTypeId', fn: reader.readUint },
  ]);
};

TypeDecoder.prototype._readEnumType = function(reader) {
  var labels = [];
  var i = 0;
  return this._readTypeHelper(reader, kind.ENUM, 'WireEnum',[
    { key: 'name', fn: reader.readString },
    { key: 'labels', fn: readLabels },
  ]);
  function readLabels() {
    return reader.readUint().then(function(length) {
      labels = new Array(length);
      return reader.readString().then(handleLabel);
    });
  }
  function handleLabel(s) {
    labels[i] = s;
    i++;
    if (i < labels.length) {
      return reader.readString().then(handleLabel);
    }
    return labels;
  }
};

TypeDecoder.prototype._readArrayType = function(reader) {
  return this._readTypeHelper(reader, kind.ARRAY, 'WireArray', [
    {key: 'name', fn: reader.readString },
    {key: 'elemTypeId', fn: reader.readUint },
    {key: 'len', fn: reader.readUint },
  ]);
};

TypeDecoder.prototype._readListType = function(reader) {
  return this._readTypeHelper(reader, kind.LIST, 'WireList', [
    {key: 'name', fn: reader.readString },
    {key: 'elemTypeId', fn: reader.readUint },
  ]);
};

TypeDecoder.prototype._readOptionalType = function(reader) {
  return this._readTypeHelper(reader, kind.OPTIONAL, 'WireList', [
    {key: 'name', fn: reader.readString },
    {key: 'elemTypeId', fn: reader.readUint },
  ]);
};

TypeDecoder.prototype._readSetType = function(reader) {
  return this._readTypeHelper(reader, kind.SET, 'WireSet', [
    {key: 'name', fn: reader.readString },
    {key: 'keyTypeId', fn: reader.readUint },
  ]);
};

TypeDecoder.prototype._readMapType = function(reader) {
  return this._readTypeHelper(reader, kind.MAP, 'WireMap', [
    {key: 'name', fn: reader.readString },
    {key: 'keyTypeId', fn: reader.readUint },
    {key: 'elemTypeId', fn: reader.readUint },
  ]);
};

TypeDecoder.prototype._readStructOrUnionType = function(reader, kind) {
  var fields = [];
  var i = 0;
  var td = this;
  return this._readTypeHelper(reader, kind, 'WireStruct', [
    {key: 'name', fn: reader.readString },
    {key: 'fields', fn: readFields },
  ]).then(function(res) {
    res.fields = res.fields || [];
    return res;
  });

  function readFields() {
    return reader.readUint().then(function(numFields) {
      fields = new Array(numFields);
      return promiseFor(numFields, readField);
    }).then(function() {
      return fields;
    });
  }

  function readField() {
    return td._readTypeHelper(reader, null, 'WireField', [
      {key: 'name', fn: reader.readString },
      {key: 'typeId', fn: reader.readUint },
    ]).then(function(field) {
      fields[i] = field;
      i++;
    });
  }
};

/**
 * Read the binary type description into a partial type description.
 * @param {Uint8Array} messageBytes The binary type message.
 * @return {PartialType} The type that was read.
 */
TypeDecoder.prototype._readPartialType = function(messageBytes) {
  var reader = new RawVomReader(messageBytes);
  var td = this;
  return reader.readUint().then(function(unionId) {
    switch (unionId) {
      case BootstrapTypes.unionIds.NAMED_TYPE:
        return td._readNamedType(reader);
      case BootstrapTypes.unionIds.ENUM_TYPE:
        return td._readEnumType(reader);
      case BootstrapTypes.unionIds.ARRAY_TYPE:
        return td._readArrayType(reader);
      case BootstrapTypes.unionIds.LIST_TYPE:
        return td._readListType(reader);
      case BootstrapTypes.unionIds.SET_TYPE:
        return td._readSetType(reader);
      case BootstrapTypes.unionIds.MAP_TYPE:
        return td._readMapType(reader);
      case BootstrapTypes.unionIds.STRUCT_TYPE:
        return td._readStructOrUnionType(reader, kind.STRUCT);
      case BootstrapTypes.unionIds.UNION_TYPE:
        return td._readStructOrUnionType(reader, kind.UNION);
      case BootstrapTypes.unionIds.OPTIONAL_TYPE:
        return td._readOptionalType(reader);
      default:
        throw new Error('Unknown wire type id ' + unionId);
    }
  });
};

},{"../gen-vdl/v.io/v23/vom":58,"../lib/async-helper":68,"../lib/deferred":69,"../lib/promise":73,"../vdl/kind.js":136,"../vdl/type-util":144,"../vdl/type.js":145,"./bootstrap-types.js":156,"./raw-vom-reader.js":167}],171:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @fileoverview Type encoder maintains a mapping of types to type ids and
 * assists in encoding types on the VOM stream.
 * @private
 */

module.exports = TypeEncoder;

var kind = require('../vdl/kind.js');
var stringify = require('../vdl/stringify.js');
var canonicalize = require('../vdl/canonicalize.js');
var util = require('../vdl/util.js');
var BootstrapTypes = require('./bootstrap-types.js');
var RawVomWriter = require('./raw-vom-writer.js');
var unwrap = require('../vdl/type-util').unwrap;
var wiretype = require('../gen-vdl/v.io/v23/vom');

var endByte = unwrap(wiretype.WireCtrlEnd);

/**
 * Create a type encoder to help encode types and associate already sent types
 * to their type ids.
 * @constructor
 * @param {module:vanadium.vom.ByteMessageWriter} messageWriter The message
 * writer to write to.
 * @param {function} flush A function that will be called every time a type
 * message has been written.  An example is to write copy the bytes in
 * messageWriter to the wire every time a type message is written.
 * @memberof module:vanadium.vom
 */
function TypeEncoder(messageWriter, flush) {
  this._typeIds = {};
  // TODO(bjornick): Use the vdl output after we fix:
  // https://github.com/veyron/release-issues/issues/1109
  this._nextId = unwrap(wiretype.WireIdFirstUserType);
  this._messageWriter = messageWriter;
  this._flush = flush;
}

/**
 * Encode a type on the specified message writer.
 * @param {module:vanadium.vom.Type} type The type to encode.
 * @return {number} The type id of the encoded type.
 */
TypeEncoder.prototype.encodeType = function(type) {
  var pending = {};
  return this._encodeType(type, pending);
};

TypeEncoder.prototype._encodeType = function(type, pending) {
  if (typeof type !== 'object') {
    throw new Error('Type must be an object, but instead had value ' + type);
  }

  // This isn't a bootstrap type, so it needs to be canonicalized.
  if (!Object.isFrozen(type)) {
    type = canonicalize.type(type);
  }

  var stringifiedType = stringify(type);

  var id = BootstrapTypes.typeStringToId(stringifiedType);
  if (id !== undefined) {
    return id;
  }

  // Check the cache of types that have been encoded already.
  id = this._typeIds[stringifiedType];
  if (id !== undefined) {
    return id;
  }

  // This type wasn't in the cache. Update it, and encode the type.
  var typeId = this._nextId++;
  this._typeIds[stringifiedType] = typeId;
  this._encodeWireType(type, typeId, pending);
  if (this._flush) {
    this._flush();
  }
  return typeId;
};

var kindToBootstrapType = function(k) {
  switch (k) {
    case kind.ANY:
      return BootstrapTypes.definitions.ANY;
    case kind.BOOL:
      return BootstrapTypes.definitions.BOOL;
    case kind.BYTE:
      return BootstrapTypes.definitions.BYTE;
    case kind.UINT16:
      return BootstrapTypes.definitions.UINT16;
    case kind.UINT32:
      return BootstrapTypes.definitions.UINT32;
    case kind.UINT64:
      return BootstrapTypes.definitions.UINT64;
    case kind.INT8:
      return BootstrapTypes.definitions.INT8;
    case kind.INT16:
      return BootstrapTypes.definitions.INT16;
    case kind.INT32:
      return BootstrapTypes.definitions.INT32;
    case kind.INT64:
      return BootstrapTypes.definitions.INT64;
    case kind.FLOAT32:
      return BootstrapTypes.definitions.FLOAT32;
    case kind.FLOAT64:
      return BootstrapTypes.definitions.FLOAT64;
    case kind.COMPLEX64:
      return BootstrapTypes.definitions.COMPLEX64;
    case kind.COMPLEX128:
      return BootstrapTypes.definitions.COMPLEX128;
    case kind.STRING:
      return BootstrapTypes.definitions.STRING;
    case kind.TYPEOBJECT:
      return BootstrapTypes.definitions.TYPEOBJECT;
    default:
      throw new Error('expected primitive kind ' + kind);
  }
};

/**
 * Write a wiretype description to the message writer.
 * @private
 * @param {MessageWriter} messageWriter the message writer.
 * @param {Type} type the type of the message.
 * @param {number} typeId the type id for the type.
 * @param {Set} pending set of types that have been referenced but not sent.
 */
TypeEncoder.prototype._encodeWireType = function(type, typeId, pending) {
  var stringifiedType = stringify(type);
  pending[stringifiedType] = true;

  var rawWriter = new RawVomWriter();
  var i;
  var elemId;
  var keyId;
  switch (type.kind) {
    case kind.ANY:
    case kind.BOOL:
    case kind.BYTE:
    case kind.UINT16:
    case kind.UINT32:
    case kind.UINT64:
    case kind.INT8:
    case kind.INT16:
    case kind.INT32:
    case kind.INT64:
    case kind.FLOAT32:
    case kind.FLOAT64:
    case kind.COMPLEX64:
    case kind.COMPLEX128:
    case kind.STRING:
    case kind.TYPEOBJECT:
      rawWriter.writeUint(BootstrapTypes.unionIds.NAMED_TYPE);
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }
      rawWriter.writeUint(1);
      rawWriter.writeUint(kindToBootstrapType(type.kind).id);
      rawWriter.writeByte(endByte);
      break;
    case kind.OPTIONAL:
      elemId = this._encodeType(type.elem, pending);
      rawWriter.writeUint(BootstrapTypes.unionIds.OPTIONAL_TYPE);
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }
      rawWriter.writeUint(1);
      rawWriter.writeUint(elemId);
      rawWriter.writeByte(endByte);
      break;
    case kind.ENUM:
      rawWriter.writeUint(BootstrapTypes.unionIds.ENUM_TYPE);
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }
      rawWriter.writeUint(1);
      rawWriter.writeUint(type.labels.length);
      for (i = 0; i < type.labels.length; i++) {
        rawWriter.writeString(type.labels[i]);
      }
      rawWriter.writeByte(endByte);
      break;
    case kind.ARRAY:
      elemId = this._encodeType(type.elem, pending);
      rawWriter.writeUint(BootstrapTypes.unionIds.ARRAY_TYPE);
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }
      rawWriter.writeUint(1);
      rawWriter.writeUint(elemId);
      rawWriter.writeUint(2);
      rawWriter.writeUint(type.len);
      rawWriter.writeByte(endByte);
      break;
    case kind.LIST:
      elemId = this._encodeType(type.elem, pending);
      rawWriter.writeUint(BootstrapTypes.unionIds.LIST_TYPE);
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }
      rawWriter.writeUint(1);
      rawWriter.writeUint(elemId);
      rawWriter.writeByte(endByte);
      break;
    case kind.SET:
      keyId = this._encodeType(type.key, pending);
      rawWriter.writeUint(BootstrapTypes.unionIds.SET_TYPE);
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }
      rawWriter.writeUint(1);
      rawWriter.writeUint(keyId);
      rawWriter.writeByte(endByte);
      break;
    case kind.MAP:
      keyId = this._encodeType(type.key, pending);
      elemId = this._encodeType(type.elem, pending);
      rawWriter.writeUint(BootstrapTypes.unionIds.MAP_TYPE);
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }
      rawWriter.writeUint(1);
      rawWriter.writeUint(keyId);
      rawWriter.writeUint(2);
      rawWriter.writeUint(elemId);
      rawWriter.writeByte(endByte);
      break;
    case kind.STRUCT:
    case kind.UNION:
      var fieldInfo = [];
      for (i = 0; i < type.fields.length; i++) {
        fieldInfo.push({
          name: util.capitalize(type.fields[i].name),
          id: this._encodeType(type.fields[i].type, pending)
        });
      }
      if (type.kind === kind.STRUCT) {
        rawWriter.writeUint(BootstrapTypes.unionIds.STRUCT_TYPE);
      } else {
        rawWriter.writeUint(BootstrapTypes.unionIds.UNION_TYPE);
      }
      if (type.name !== '') {
        rawWriter.writeUint(0);
        rawWriter.writeString(type.name);
      }

      rawWriter.writeUint(1);
      rawWriter.writeUint(fieldInfo.length);
      for (i = 0; i < fieldInfo.length; i++) {
        var field = fieldInfo[i];
        rawWriter.writeUint(0);
        rawWriter.writeString(field.name);
        rawWriter.writeUint(1);
        rawWriter.writeUint(field.id);
        rawWriter.writeByte(endByte);
      }
      rawWriter.writeByte(endByte);
      break;
    default:
      throw new Error('encodeWireType with unknown kind: ' + type.kind);
  }

  delete pending[stringifiedType];
  var seen = {};
  var isIncomplete = _typeIncomplete(type, pending, seen);
  this._messageWriter.writeTypeMessage(typeId, rawWriter.getBytes(),
    isIncomplete);
};

function _typeIncomplete(type, pending, seen) {
  var stringifiedType = stringify(type);
  if (seen.hasOwnProperty(stringifiedType)) {
    return false;
  }
  seen[stringifiedType] = true;
  if (pending.hasOwnProperty(stringifiedType)) {
    return true;
  }
  switch (type.kind) {
    case kind.OPTIONAL:
    case kind.ARRAY:
    case kind.LIST:
      return _typeIncomplete(type.elem, pending, seen);
    case kind.SET:
    return _typeIncomplete(type.key, pending, seen);
    case kind.MAP:
    return _typeIncomplete(type.key, pending, seen) ||
      _typeIncomplete(type.elem, pending, seen);
    case kind.STRUCT:
    case kind.UNION:
      for (var i = 0; i < type.fields.length; i++) {
        if (_typeIncomplete(type.fields[i].type, pending, seen)) {
          return true;
        }
      }
      return false;
    default:
      return false;
  }
}

},{"../gen-vdl/v.io/v23/vom":58,"../vdl/canonicalize.js":126,"../vdl/kind.js":136,"../vdl/stringify.js":141,"../vdl/type-util":144,"../vdl/util.js":147,"./bootstrap-types.js":156,"./raw-vom-writer.js":168}],172:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @private
 * @fileoverview Definition of constants for VOM versions.
 */

 module.exports = {
   version80: 0x80,
   version81: 0x81,
   defaultVersion: 0x80,
   allowedVersions: [0x80, 0x81]
 };

},{}],173:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/**
 * @summary Namespace vtrace defines a system for collecting debugging
 * information about operations that span a distributed system.
 * @description
 * <p> Namespace vtrace defines a system for collecting debugging
 * information about operations that span a distributed system.  We
 * call the debugging information attached to one operation a Trace.
 * A Trace may span many processes on many machines.</p>
 *
 * <p>Traces are composed of a hierarchy of Spans.  A span is a named
 * timespan, that is, it has a name, a start time, and an end time.
 * For example, imagine we are making a new blog post.  We may have to
 * first authentiate with an auth server, then write the new post to a
 * database, and finally notify subscribers of the new content.  The
 * trace might look like this:</p>
 *
 * <pre>
 *    Trace:
 *    <---------------- Make a new blog post ----------->
 *    |                  |                   |
 *    <- Authenticate -> |                   |
 *                       |                   |
 *                       <-- Write to DB --> |
 *                                           <- Notify ->
 *    0s                      1.5s                      3s
 * </pre>
 *
 * <p>Here we have a single trace with four Spans.  Note that some
 * Spans are children of other Spans.  Vtrace works by attaching data
 * to a Context, and this hierarchical structure falls directly out
 * of our building off of the tree of Contexts.  When you derive a new
 * context using withNewSpan(), you create a Span that's a child of the
 * currently active span in the context.  Note that spans that share a
 * parent may overlap in time.</p>
 *
 * <p>In this case the tree would have been created with code like this:</p>
 *
 * <pre>
 *    function makeBlogPost(ctx) {
 *        var authCtx = vtrace.withNewSpan(ctx, "Authenticate")
 *        authenticate(authCtx).then(function() {
 *          var writeCtx = vtrace.withNewSpan(ctx, "Write To DB")
 *          write(writeCtx)
 *        }).then(function() {
 *          var notifyCtx = vtrace.withNewSpan(ctx, "Notify")
 *          notify(notifyCtx)
 *        });
 *    }
 * </pre>
 *
 * <p>Just as we have Spans to represent time spans we have Annotations
 * to attach debugging information that is relevant to the current
 * moment. You can add an annotation to the current span by calling
 * the Span's Annotate method:</p>
 *
 * <pre>
 *    var span = vtrace.getSpan(ctx)
 *    span.annotate("Just got an error")
 * </pre>
 *
 * <p>When you make an annotation we record the annotation and the time
 * when it was attached.</p>
 *
 * <p>Traces can be composed of large numbers of spans containing data
 * collected from large numbers of different processes.  Always
 * collecting this information would have a negative impact on
 * performance.  By default we don't collect any data.  If a
 * particular operation is of special importance you can force it to
 * be collected by calling a Spans forceCollect method.  You can also
 * call:
 * <pre>
 *   vtrace.getStore(ctx).setCollectRegexp("regular.*expression")
 * </pre>
 * which causes us to record any matching trace.</p>
 *
 * <p>If your trace has collected information you can retrieve the data
 * collected so far with the Store's traceRecord and traceRecords methods.</p>
 *
 * <p>By default contexts obtained from runtime.getContext() or from
 * the first parameter of a server method implementation already have
 * an initialized Trace.  The functions in this package allow you to
 * add data to existing traces or start new ones.</p>
 * @namespace
 * @name vtrace
 * @memberof module:vanadium
 */
var extend = require('xtend');

module.exports = extend(
  require('./vtrace'),
  require('../gen-vdl/v.io/v23/vtrace')
);

},{"../gen-vdl/v.io/v23/vtrace":59,"./vtrace":174,"xtend":41}],174:[function(require,module,exports){
// Copyright 2015 The Vanadium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var uniqueid = require('../lib/uniqueid');
var context = require('../context');
var vdl = require('../gen-vdl/v.io/v23/vtrace');
var vlog = require('../lib/vlog');

var spanKey = context.ContextKey();
var storeKey = context.ContextKey();

var second = 1000;
var minute = 60 * second;
var hour = 60 * minute;
var indentStep = '    ';

module.exports = {
  withNewTrace: withNewTrace,
  withContinuedTrace: withContinuedTrace,
  withNewSpan: withNewSpan,
  withNewStore: withNewStore,
  getSpan: getSpan,
  getStore: getStore,
  forceCollect: forceCollect,
  formatTraces: formatTraces,
  request: request,
  response: response
};

/**
 * Create a map key from a uniqueid.Id.
 * @private
 * @param {Object} A uniqueid.Id instance.
 * @return {string} A string key for use as a map key.
 */
function key(id) {
  return uniqueid.toHexString(id);
}

/**
 * @summary A Span represents a named span of time.
 * @description
 * <p>Private constructor, use {@link module:vanadium.vtrace.getSpan}.</p>
 * Spans have a beginning and can contain annotations which mark
 * specific moments.
 * @constructor
 * @param {string} name The name of the Span.
 * @param {Object} store A vtrace Store instance.
 * @param {Object} trace A uniqueid.Id instance identifying the trace.
 * @param {Object} parent A uniqueid.Id instance identifying this Spans parent.
 * @memberof module:vanadium.vtrace
 * @inner
 */
function Span(name, store, trace, parent) {
  if (!(this instanceof Span)) {
    return new Span(name, trace, parent, store);
  }

  Object.defineProperty(this, 'name', {
    writable: false,
    value: name
  });
  Object.defineProperty(this, 'id', {
    writable: false,
    value: uniqueid.random()
  });

  if (trace === undefined && parent === undefined) {
    parent = uniqueid.random();
    trace = parent;
  }
  Object.defineProperty(this, 'parent', {
    writable: false,
    value: parent
  });
  Object.defineProperty(this, 'trace', {
    writable: false,
    value: trace
  });

  this._store = store;
  store._start(this);
}

/**
 * Adds an annotation to the Span.
 * @param {string} msg A string annotation.
 */
Span.prototype.annotate = function(msg) {
  this._store._annotate(this, msg);
};

/**
 * Marks the current Span as finished, recording the end time.
 */
Span.prototype.finish = function() {
  this._store._finish(this);
};

function Node(id) {
  this.id = id;
  this.spans = {};
}

Node.prototype.record = function() {
  var record = new vdl.TraceRecord();
  record.id = this.id;
  for (var id in this.spans) {
    if (!this.spans.hasOwnProperty(id)) {
      continue;
    }
    var span = this.spans[id];
    record.spans.push(new vdl.SpanRecord(span));
  }
  return record;
};

/**
 * @summary Store collects the information of interesting traces in memory.
 * @description
 * Private constructor. Use {@link module:vanadium.vtrace.getStore} <br>
 * A vtrace Store.
 * A Store is responsible for saving traces for later reporting and analysis.
 * @constructor
 * @inner
 * @memberof module:vanadium.vtrace
 */
function Store() {
  if (!(this instanceof Store)) {
    return new Store();
  }

  this._collectRegexp = null;
  this._nodes = {};
}

/**
 * Filters the information collected by the Store
 * @param {string} regexp The regular expression that must
 * be matched by the span name in order for that span to be
 * collected
 */
Store.prototype.setCollectRegexp = function(regexp) {
  this._collectRegexp = new RegExp(regexp);
};

Store.prototype._flags = function(id) {
  var node = this._nodes[key(id)];
  if (!node) {
    return vdl.Empty;
  }
  return vdl.CollectInMemory;
};

/**
 * Returns vtrace.TraceRecord instances for all traces recorded by the store.
 * @return {Array<module:vanadium.vtrace.TraceRecord>} An array of
 * vtrace.TraceRecord instances.
 */
Store.prototype.traceRecords = function() {
  var out = [];
  for (var key in this._nodes) {
    if (!this._nodes.hasOwnProperty(key)) {
      continue;
    }
    out.push(this._nodes[key].record());
  }
  return out;
};

/**
 * Returns a [TraceRecord]{@link module:vanadium.vtrace.TraceRecord} for
 * the given trace id.
 * @param {module:vanadium.uniqueId.Id} id A uniqueid.Id instance.
 * @return {module:vanadium.vtrace.TraceRecord} a vtrace.TraceRecord instance.
 */
Store.prototype.traceRecord = function(id) {
  var node = this._nodes[key(id)];
  if (!node) {
    var record = vdl.TraceRecord();
    record.id = id;
    return record;
  }
  return node.record();
};

// _getNode get's a trace node from the store.  shouldCreate
// is either a boolean or a function that returns a boolean.
// if shouldCreate or shouldCreate() is true, then we will create the node
// if it does not exist, otherwise we'll return null.
Store.prototype._getNode = function(traceid, shouldCreate) {
  var k = key(traceid);
  var node = this._nodes[k];
  if (node) {
    return node;
  }
  if (typeof shouldCreate === 'function') {
    shouldCreate = shouldCreate();
  }
  if (shouldCreate) {
    node = new Node(traceid);
    this._nodes[k] = node;
  }
  return node;
};

Store.prototype._getSpan = function(span, shouldCreate) {
  var node = this._getNode(span.trace, shouldCreate);
  if (!node) {
    return null;
  }
  var spankey = key(span.id);
  var record = node.spans[spankey];
  if (!record) {
    record = new vdl.SpanRecord();
    record.id = span.id;
    record.parent = span.parent;
    record.name = span.name;
    node.spans[spankey] = record;
  }
  return record;
};

Store.prototype._start = function(span) {
  var store = this;
  var record = this._getSpan(span, function() {
    var re = store._collectRegexp;
    return re && re.test(span.name);
  });
  if (record) {
    record.start = store._now();
  }
};

Store.prototype._finish = function(span) {
  var store = this;
  var record = this._getSpan(span, function() {
    var re = store._collectRegexp;
    return re && re.test(span.name);
  });
  if (record) {
    record.end = store._now();
  }
};

Store.prototype._annotate = function(span, msg) {
  var store = this;
  var record = this._getSpan(span, function() {
    var re = store._collectRegexp;
    return re && re.test(msg);
  });
  if (record) {
    var annotation = new vdl.Annotation();
    annotation.when = store._now();
    annotation.message = msg;
    record.annotations.push(annotation);
  }
};

Store.prototype._now = function() {
  return new Date();
};

/**
 * Merges a response into the store, adding information on the
 * Span in contains into the local database.
 * @param {module:vanadium.vtrace~Response} response A
 * [Response]{@link module.vanadium.vtrace~Response} instance.
 */
Store.prototype.merge = function(response) {
  if (!uniqueid.valid(response.trace.id)) {
    return;
  }
  var shouldCreate = (response.flags & vdl.CollectInMemory) !== 0;
  var node = this._getNode(response.trace.id, shouldCreate);
  if (!node) {
    return;
  }
  var spans = response.trace.spans;
  for (var i = 0; i < spans.length; i++) {
    var span = spans[i];
    node.spans[key(span.id)] = span;
  }
};

/**
 * Creates a new [Span]{@link module:vanadium.vtrace~Span} that represents
 * the beginning of a new trace and attaches it to a new context derived from
 * ctx.  This should be used when starting operations unrelated to other
 * ongoing traces.
 * @param {module:vanadium.context.Context} ctx A context.Context instance
 * to derive a new context from.
 * @return {module:vanadium.context.Context} A new context with a new Span
 * attached.
 * @memberof module:vanadium.vtrace
 */
function withNewTrace(ctx) {
  return ctx.withValue(spanKey, new Span('', ctx.value(storeKey)));
}

/**
 * Creates a new [Span]{@link module:vanadium.vtrace~Span} that continues
 * a trace represented in request. The new Span will be attached to the
 * returned context.
 * @param {module:vanadium.context.Context} ctx A context.Context instance to
 * derive a new context from.
 * @param {string} name The name of the new Span.
 * @param {module:vanadium.vtrace~Request} request A
 * [Request]{@link module:vanadium.vtrace~Request} instance.
 * @return {module:vanadium.context.Context} A new context with a new Span
 * attached.
 * @memberof module:vanadium.vtrace
 */
function withContinuedTrace(ctx, name, request) {
  var store = ctx.value(storeKey);
  if (request.flags & vdl.CollectInMemory !== 0) {
    store._getNode(request.traceId, true);
  }
  var span = new Span(name, store, request.traceId, request.spanId);
  return ctx.withValue(spanKey, span);
}

/**
 * Creates a new [Span]{@link module:vanadium.vtrace~Span} that continues
 * the trace attached to ctx.
 * @param {module:vanadium.context.Context} ctx A context.Context instance to
 * derive a new context from.
 * @param {string} name The name of the new Span.
 * @return {module:vanadium.context.Context} A new context with a new Span
 * attached.
 * @memberof module:vanadium.vtrace
 */
function withNewSpan(ctx, name) {
  var oldSpan = ctx.value(spanKey);
  var oldStore = ctx.value(storeKey);
  var span = new Span(name, oldStore, oldSpan.trace, oldSpan.id);
  return ctx.withValue(spanKey, span);
}

/**
 * Return the [Span]{@link module:vanadium.vtrace~Span} attached to ctx.
 * @param {module:vanadium.context.Context} ctx A context.Context instance.
 * @return {module:vanadium.vtrace.SpanRecord} A Span instance.
 * @memberof module:vanadium.vtrace
 */
function getSpan(ctx) {
  return ctx.value(spanKey);
}

/**
 * Creates a new [Store]{@link module:vanadium.vtrace~Store} and returns
 * a new context derived from ctx with the store attached.
 * @param {module:vanadium.context.Context} ctx A context.Context instance to
 * derive a new context from.
 * @return {module:vanadium.context.Context} A new context with a new Store
 * attached.
 * @memberof module:vanadium.vtrace
 */
function withNewStore(ctx) {
  var store = new Store();
  return ctx.withValue(storeKey, store);
}

/**
 * Return the Store attached to ctx.
 * @param {module:vanadium.context.Context} ctx A context.Context instance.
 * @return {module:vanadium.vtrace~Store} A {@link Store} instance.
 * @memberof module:vanadium.vtrace
 */
function getStore(ctx) {
  return ctx.value(storeKey);
}

/**
 * Force collection of the current trace.
 * @param {module:vanadium.context.Context} ctx A context.Context instance.
 * @memberof module:vanadium.vtrace
 */
function forceCollect(ctx) {
  var store = ctx.value(storeKey);
  var span = ctx.value(spanKey);
  store._getNode(span.trace, true);
}

/**
 * Generate a [Request]{@link module:vanadium.vtrace~Request} to send over
 * the wire.
 * @param {module:vanadium.context.Context} ctx A context.Context instance.
 * @return {module:vanadium.vtrace~Request} request a
 * [Request]{@link module:vanadium.vtrace~Request} instance.
 * @memberof module:vanadium.vtrace
 */
function request(ctx) {
  var store = ctx.value(storeKey);
  var span = ctx.value(spanKey);
  return vdl.Request({
    spanId: span.id,
    traceId: span.trace,
    flags: store._flags(span.trace)
  });
}

/**
 * Generate a [Response]{@link module:vanadium.vtrace~Response} to send over the
 * wire.
 * @param {module:vanadium.context.Context} ctx A context.Context instance.
 * @return {module:vanadium.vtrace~Response} A
 * [Response]{@link module:vanadium.vtrace~Response} instance.
 * @memberof module:vanadium.vtrace
 */
function response(ctx) {
  if (!ctx) {
    vlog.logger.warn('Cannot perform vtrace without valid context');
    return;
  }
  var store = ctx.value(storeKey);
  var span = ctx.value(spanKey);
  return vdl.Response({
    flags: store._flags(span.trace),
    trace: store.traceRecord(span.trace)
  });
}

var zeroMs = Date.parse('0001-01-01');
// Returns true if the given date is the zero date, by the definition of VDL.
function isZeroDate(d) {
  return d.getTime() === zeroMs;
}

function Tree(span) {
  this._span = span;
  this._children = [];
}

function buildTree(record) {
  var t;
  var tid;
  var root;
  var earliest = new Date(zeroMs);
  var traceKey = key(record.id);

  var trees = {};
  record.spans.forEach(function(span) {
    // We want to find the lowest valid (non-zero) timestamp in the trace.
    // If we have a non-zero timestamp, save it if it's the earliest (or
    // this is the first valid timestamp we've seen).
    if (!isZeroDate(span.start)) {
      if (isZeroDate(earliest) || span.start < earliest) {
        earliest = span.start;
      }
    }
    tid = key(span.id);
    t = trees[tid];
    if (!t) {
      t = new Tree(span);
      trees[tid] = t;
    }

    var parentKey = key(span.parent);
    if (parentKey === traceKey) {
      root = t;
    } else {
      var parent = trees[parentKey];
      if (!parent) {
        parent = new Tree();
        trees[parentKey] = parent;
      }
      parent._children.push(t);
    }
  });

  // Sort the children of each node in start time order, and the
  // annotations in time order.
  for (tid in trees) {
    if (!trees.hasOwnProperty(tid)) {
      continue;
    }
    t = trees[tid];
    t._children.sort(function(a, b) {
      return a.start - b.start;
    });
    if (t._span && t._span.annotations) {
      t._span.annotations.sort(function(a, b) {
        return a.when - b.when;
      });
    }
  }

  // If we didn't find the root of the trace, create a stand-in.
  if (!root) {
    root = new Tree(new vdl.SpanRecord({
      name: 'Missing Root Span',
      start: earliest
    }));
  } else if (isZeroDate(root._span.start)) {
    root._span.start = earliest;
  }

  // Find all nodes that have no span.  These represent missing data
  // in the tree.  We invent fake "missing" spans to represent
  // (perhaps several) layers of missing spans.  Then we add these as
  // children of the root.
  var missing = [];
  for (tid in trees) {
    if (!trees.hasOwnProperty(tid)) {
      continue;
    }
    t = trees[tid];
    if (!t._span) {
      t._span = new vdl.SpanRecord({
        name: 'Missing Data'
      });
      missing.push(t);
    }
  }
  root._children = root._children.concat(missing);
  root._children.sort(function(a, b) {
    return a.start - b.start;
  });
  return root;
}

function formatDelta(when, start) {
  if (isZeroDate(when)) {
    return '??';
  }
  var out = '';
  var delta = when - start;
  if (delta === 0) {
    return '0';
  }
  if (delta < 0) {
    out += '-';
    delta = -delta;
  }
  if (delta < second) {
    return delta + 'ms';
  }
  if (delta > hour) {
    var hours = Math.floor(delta / hour);
    delta -= hours * hour;
    out += hours + 'h';
  }
  if (delta > minute) {
    var minutes = Math.floor(delta / minute);
    delta -= minutes * minute;
    out += minutes + 'm';
  }
  out += (delta / 1000) + 's';
  return out;
}


function formatTime(when) {
  if (isZeroDate(when)) {
    return '??';
  }
  return when.toISOString();
}

function formatAnnotations(annotations, traceStart, indent) {
  var out = '';
  for (var a = 0; a < annotations.length; a++) {
    var annotation = annotations[a];
    out += indent + '@' + formatDelta(annotation.when, traceStart);
    out += ' ' + annotation.message + '\n';
  }
  return out;
}

function formatTree(tree, traceStart, indent) {
  var span = tree._span;
  var out = indent + 'Span - ' + span.name;
  out += ' [id: ' + key(span.id).slice(24);
  out += ' parent: ' + key(span.parent).slice(24) + ']';
  out += ' (' + formatDelta(span.start, traceStart);
  out += ', ' + formatDelta(span.end, traceStart) + ')\n';

  indent += indentStep;
  out += formatAnnotations(span.annotations, traceStart, indent);
  for (var c = 0; c < tree._children.length; c++) {
    out += formatTree(tree._children[c], traceStart, indent);
  }
  return out;
}

function formatTrace(record) {
  var root = buildTree(record);
  if (!root) {
    return null;
  }
  var span = root._span;
  var out = 'Trace - ' + key(record.id);
  out += ' (' + formatTime(span.start) + ', ' + formatTime(span.end) + ')\n';
  out += formatAnnotations(span.annotations, span.start, indentStep);
  for (var c = 0; c < root._children.length; c++) {
    out += formatTree(root._children[c], span.start, indentStep);
  }
  return out;
}

/**
 * Return a string representation of a trace (or array of traces).
 * @param {Array<module:vanadium.vtrace.TraceRecord>} traces Trace records.
 * @return {string} A human friendly string representation of the trace.
 * @memberof module:vanadium.vtrace
 */
function formatTraces(traces) {
  if (!Array.isArray(traces)) {
    traces = [traces];
  }
  if (traces.length === 0) {
    return '';
  }
  var out = 'Vtrace traces:\n';
  for (var r = 0; r < traces.length; r++) {
    out += formatTrace(traces[r]);
  }
  return out;
}

},{"../context":48,"../gen-vdl/v.io/v23/vtrace":59,"../lib/uniqueid":77,"../lib/vlog":79}],175:[function(require,module,exports){
var vanadium = require('vanadium');

// Define HelloService and the hello() method.
function HelloService() {}

HelloService.prototype.hello = function(ctx, serverCall, greeting) {
  displayHello(greeting);
};

// Initialize Vanadium runtime.
vanadium.init(function(err, runtime) {
  if (err) {
    showStatus('Initialization error: ' + err);
    return;
  }
  showStatus('Initialized');
  runtime.on('crash', function(err) {
    showStatus('The runtime has crashed unexpectedly and the page must be reloaded.');
  });

  setupServer(runtime);
  setupClient(runtime);
});

// Setup the server.
function setupServer(runtime) {
  // Create a server and serve the HelloService.
  var serviceName = getLocalPeerName(runtime.accountName);
  runtime.newServer(serviceName, new HelloService(), function(err) {
    if (err) {
      showServerStatus('Failed to serve ' + serviceName + ': ' + err);
      return;
    }
    showServerStatus('Serving');
    // HelloService is now served.
  });
}

// Setup the client.
function setupClient(runtime) {
  // Create a client and bind to the service.
  var client = runtime.getClient();
  var ctx = runtime.getContext();

  var serviceName = getRemotePeerName(runtime.accountName);
  showClientStatus('Binding');
  client.bindTo(ctx, serviceName, function(err, helloService) {
    if (err) {
      showClientStatus('Failed to bind to ' + serviceName + ': ' + err);
      return;
    }
    showClientStatus('Ready');

    registerButtonHandler(function(greeting) {
      showClientStatus('Calling');
      // Call hello() on the service.
      helloService.hello(ctx, greeting, function(err) {
        if (err) {
          showClientStatus('Error invoking hello(): ' + err);
          return;
        }
        showClientStatus('Ready');
      });
    });
  });
}

// Get the local and remote names.
function getLocalPeerName(accountName) {
  var homeDir = accountName.replace(/^dev.v.io:u:/, 'users/').replace(vanadium.security.ChainSeparator.val, '/');
  var hash = window.location.hash;
  return homeDir + '/tutorial/hello' + hash;
}
function getRemotePeerName(accountName) {
  var localPeer = getLocalPeerName(accountName);
  var splitPeer = localPeer.split('#');
  if (splitPeer[1] == 'A') {
    splitPeer[1] = 'B';
  } else {
    splitPeer[1] = 'A';
  }
  return splitPeer.join('#');
}

// Manipulate the html page.
function displayHello(greeting) {
  var li = document.createElement('li');
  li.textContent = greeting;
  document.getElementById('receivedhellos').appendChild(li);
}
function registerButtonHandler(fn) {
  document.getElementById('hellobutton').addEventListener('click', function() {
    var greeting = document.getElementById('hellotext').value;
    fn(greeting);
  });
}
function showClientStatus(text) {
  document.getElementById('clientstatus').textContent = text;
}
function showServerStatus(text) {
  document.getElementById('serverstatus').textContent = text;
}
function showStatus(text) {
  showClientStatus(text);
  showServerStatus(text);
}

},{"vanadium":123}]},{},[175]);

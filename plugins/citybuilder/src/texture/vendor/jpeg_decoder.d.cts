declare function decodeJpeg(data: Uint8Array, options: {useTArray: boolean; formatAsRGBA: boolean}): {width:number; height:number; data:Uint8Array};
export = decodeJpeg;

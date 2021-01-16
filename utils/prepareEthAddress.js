function prepareETHAddress(address) {
  if (!address.startsWith("0x")) {
    return "0x" + address;
  }

  return address;
}

module.exports = {
  prepareETHAddress,
};

const BaseAccessory = require('./BaseAccessory');

class SimpleHeaterAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.AIR_HEATER;
    }

    constructor(...props) {
        super(...props);

        this.cmdHeat = 'HEAT';
        if (this.device.context.cmdHeat) {
            if (/^[a-z0-9]+$/i.test(this.device.context.cmdHeat)) this.cmdHeat = ('' + this.device.context.cmdHeat).trim();
            else throw new Error('The cmdHeat doesn\'t appear to be valid: ' + this.device.context.cmdHeat);
        }

        this.cmdAuto = 'AUTO';
        if (this.device.context.cmdAuto) {
            if (/^[a-z0-9]+$/i.test(this.device.context.cmdAuto)) this.cmdAuto = ('' + this.device.context.cmdAuto).trim();
            else throw new Error('The cmdAuto doesn\'t appear to be valid: ' + this.device.context.cmdAuto);
        }
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.HeaterCooler, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.HeaterCooler);
        this._checkServiceName(service, this.device.context.name);

        this.dpActive = this._getCustomDP(this.device.context.dpActive) || '1';
        this.dpDesiredTemperature = this._getCustomDP(this.device.context.dpDesiredTemperature) || '2';
        this.dpCurrentTemperature = this._getCustomDP(this.device.context.dpCurrentTemperature) || '3';
        this.temperatureDivisor = parseInt(this.device.context.temperatureDivisor) || 1;
        this.thresholdTemperatureDivisor = parseInt(this.device.context.thresholdTemperatureDivisor) || 1;
        this.targetTemperatureDivisor = parseInt(this.device.context.targetTemperatureDivisor) || 1;
        this.dpMode = this._getCustomDP(this.device.context.dpMode) || '4';
        this.dpChildLock = this._getCustomDP(this.device.context.dpChildLock) || '6';

        const characteristicActive = service.getCharacteristic(Characteristic.Active)
            .updateValue(this._getActive(dps[this.dpActive]))
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));

        const characteristicCurrentHeaterCoolerState = service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .updateValue(this._getCurrentHeaterCoolerState(dps))
            .on('get', this.getCurrentHeaterCoolerState.bind(this));

        const _validTargetHeaterCoolerStateValues = [Characteristic.TargetHeaterCoolerState.HEAT]
        if (!this.device.context.noAuto) _validTargetHeaterCoolerStateValues.unshift(Characteristic.TargetHeaterCoolerState.AUTO);
        const characteristicTargetHeaterCoolerState = service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({
                minValue: 0,
                maxValue: 3,
                validValues: _validTargetHeaterCoolerStateValues
            })
            .updateValue(this._getTargetHeaterCoolerState(dps[this.dpMode]))
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));

        const characteristicCurrentTemperature = service.getCharacteristic(Characteristic.CurrentTemperature)
            .updateValue(this._getDividedState(dps[this.dpCurrentTemperature], this.temperatureDivisor))
            .on('get', this.getDividedState.bind(this, this.dpCurrentTemperature, this.temperatureDivisor));

        let characteristicLockPhysicalControls;
        if (!this.device.context.noChildLock) {
            characteristicLockPhysicalControls = service.getCharacteristic(Characteristic.LockPhysicalControls)
                .updateValue(this._getLockPhysicalControls(dps[this.dpChildLock]))
                .on('get', this.getLockPhysicalControls.bind(this))
                .on('set', this.setLockPhysicalControls.bind(this));
        } else this._removeCharacteristic(service, Characteristic.LockPhysicalControls);

        const characteristicHeatingThresholdTemperature = service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: this.device.context.minTemperature || 15,
                maxValue: this.device.context.maxTemperature || 35,
                minStep: this.device.context.minTemperatureSteps || 1
            })
            .updateValue(this._getDividedState(dps[this.dpDesiredTemperature], this.thresholdTemperatureDivisor))
            .on('get', this.getDividedState.bind(this, this.dpDesiredTemperature, this.thresholdTemperatureDivisor))
            .on('set', this.setTargetThresholdTemperature.bind(this));

        this.characteristicHeatingThresholdTemperature = characteristicHeatingThresholdTemperature;

        service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: this.device.context.minTemperature || 15,
                maxValue: this.device.context.maxTemperature || 35,
                minStep: this.device.context.minTemperatureSteps || 0.5
            })
            .on('get', this.getDividedState.bind(this, this.dpDesiredTemperature, this.thresholdTemperatureDivisor))
       	    .on('set', (value, callback) => callback(null, true));


        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpActive)) {
                const newActive = this._getActive(changes[this.dpActive]);
                if (characteristicActive.value !== newActive) {
                    characteristicActive.updateValue(newActive);

                    if (!changes.hasOwnProperty(this.dpMode)) {
                        characteristicCurrentHeaterCoolerState.updateValue(this._getCurrentHeaterCoolerState(state));
                    }

                }
            }

            if (changes.hasOwnProperty(this.dpDesiredTemperature)) {
                if (characteristicHeatingThresholdTemperature.value !== changes[this.dpDesiredTemperature])
                    characteristicHeatingThresholdTemperature.updateValue(changes[this.dpDesiredTemperature * this.targetTemperatureDivisor]);
            }

            if (characteristicLockPhysicalControls && changes.hasOwnProperty(this.dpChildLock)) {
                const newLockPhysicalControls = this._getLockPhysicalControls(changes[this.dpChildLock]);
                if (characteristicLockPhysicalControls.value !== newLockPhysicalControls) {
                    characteristicLockPhysicalControls.updateValue(newLockPhysicalControls);
                }
            }

            if (changes.hasOwnProperty(this.dpMode)) {
                const newTargetHeaterCoolerState = this._getTargetHeaterCoolerState(changes[this.dpMode]);
                const newCurrentHeaterCoolerState = this._getCurrentHeaterCoolerState(state);
                if (characteristicTargetHeaterCoolerState.value !== newTargetHeaterCoolerState) characteristicTargetHeaterCoolerState.updateValue(newTargetHeaterCoolerState);
                if (characteristicCurrentHeaterCoolerState.value !== newCurrentHeaterCoolerState) characteristicCurrentHeaterCoolerState.updateValue(newCurrentHeaterCoolerState);
            }

            if (changes.hasOwnProperty(this.dpCurrentTemperature) && characteristicCurrentTemperature.value !== changes[this.dpCurrentTemperature]) characteristicCurrentTemperature.updateValue(this._getDividedState(changes[this.dpCurrentTemperature], this.temperatureDivisor));

            this.log.info('SimpleHeater changed: ' + JSON.stringify(state));
        });
    }

    getActive(callback) {
        this.getState(this.dpActive, (err, dp) => {
            if (err) return callback(err);

            callback(null, this._getActive(dp));
        });
    }

    _getActive(dp) {
        const {Characteristic} = this.hap;

        return dp ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    }

    setActive(value, callback) {
        const {Characteristic} = this.hap;

        switch (value) {
            case Characteristic.Active.ACTIVE:
                return this.setState(this.dpActive, true, callback);

            case Characteristic.Active.INACTIVE:
                return this.setState(this.dpActive, false, callback);
        }

        callback();
    }

    getLockPhysicalControls(callback) {
        this.getState(this.dpChildLock, (err, dp) => {
            if (err) return callback(err);

            callback(null, this._getLockPhysicalControls(dp));
        });
    }

    _getLockPhysicalControls(dp) {
        const {Characteristic} = this.hap;

        return dp ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
    }

    setLockPhysicalControls(value, callback) {
        const {Characteristic} = this.hap;

        switch (value) {
            case Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED:
                return this.setState(this.dpChildLock, true, callback);

            case Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED:
                return this.setState(this.dpChildLock, false, callback);
        }

        callback();
    }

    getCurrentHeaterCoolerState(callback) {
        this.getState([this.dpActive], (err, dps) => {
            if (err) return callback(err);

            callback(null, this._getCurrentHeaterCoolerState(dps));
        });
    }

    _getCurrentHeaterCoolerState(dps) {
        const {Characteristic} = this.hap;
        if (!dps[this.dpActive]) return Characteristic.CurrentHeaterCoolerState.INACTIVE;

        switch (dps[this.dpMode]) {
            case this.cmdHeat:
                return Characteristic.CurrentHeaterCoolerState.HEATING;

            default:
                return Characteristic.CurrentHeaterCoolerState.IDLE;
        }
    }

    getTargetHeaterCoolerState(callback) {
        this.getState(this.dpMode, (err, dp) => {
            if (err) return callback(err);

            callback(null, this._getTargetHeaterCoolerState(dp));
        });
    }

    _getTargetHeaterCoolerState(dp) {
        const {Characteristic} = this.hap;
        switch (dp) {
            case this.cmdHeat:
                return Characteristic.TargetHeaterCoolerState.HEAT;

            case this.cmdAuto:
                if (this.device.context.noAuto) return Characteristic.TargetHeaterCoolerState.HEAT;
                return Characteristic.TargetHeaterCoolerState.AUTO;

            default:
                return Characteristic.TargetHeaterCoolerState.HEAT;
        }
    }

    setTargetHeaterCoolerState(value, callback) {
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.TargetHeaterCoolerState.HEAT:
                return this.setState(this.dpMode, this.cmdHeat, callback);

            case Characteristic.TargetHeaterCoolerState.AUTO:
                if (this.device.context.noAuto) return callback();
                return this.setState(this.dpMode, this.cmdAuto, callback);
        }

        callback();
    }

    setTargetThresholdTemperature(value, callback) {
        this.setState(this.dpDesiredTemperature, value * this.thresholdTemperatureDivisor, err => {
            if (err) return callback(err);

            if (this.characteristicHeatingThresholdTemperature) {
                this.characteristicHeatingThresholdTemperature.updateValue(value);
            }

            callback();
        });
    }
}

module.exports = SimpleHeaterAccessory;

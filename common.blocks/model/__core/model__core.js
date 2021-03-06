modules.define('model',
    ['inherit', 'events', 'identify', 'objects', 'functions', 'functions__throttle', 'functions__debounce'],
    function(provide, inherit, events, identify, objects, functions, throttle, debounce) {

        var changesTimeout = 500,
            CHILD_SEPARATOR = '.',
            ID_SEPARATOR = ':',
            MODELS_SEPARATOR = ',',
            ANY_ID = '*',
            modelsGroupsCache = {},

            /**
             * Ядро. Реализует глобальный Model, его статические методы и базовый класс
             * @namespace
             * @name Model
             */
            Model;

        Model = inherit(events.Emitter, {

            /**
             * Минимальное время между событиями на модели
             */
            changesTimeout: changesTimeout,

            /**
             * @class Конструктор модели
             * @constructs
             * @param {String|Object} modelParams параметры модели
             * @param {String} modelParams.name имя модели
             * @param {String|Number} [modelParams.id] идентификатор модели
             * @param {String} [modelParams.parentName] имя родительской модели
             * @param {String} [modelParams.parentPath] путь родительской модели
             * @param {Object} [modelParams.parentModel] экземпляр родительской модели
             * @param {Object} [data] данные для инициализации полей модели
             * @returns {Model}
             * @private
             */
            __constructor: function(modelParams, data) {
                this.name = modelParams.name;
                this.id = modelParams.id;
                this._path = Model.buildPath(modelParams);
                this.changed = [];

                this._initFields(data || {});

                return this;
            },

            /**
             * Возвращает путь модели
             * @returns {String}
             */
            path: function() {
                return this._path;
            },

            /**
             * Инициализирует поля модели
             * @param {Object} data данные для инициализации полей модели
             * @returns {Model}
             * @private
             */
            _initFields: function(data) {
                var name = this.name,
                    _this = this;

                this.fieldsDecl = Model.decls[name];
                this.fields = {};

                this
                    .on('field-init', function(e, data) {
                        if (!this.fieldsDecl[data.field].calculate)
                            return _this._calcDependsTo(data.field, data);
                    })
                    .on('field-change', function(e, data) {
                        return _this._onFieldChange(data.field, data);
                    });

                objects.each(this.fieldsDecl, function(props, name) {
                    _this.fields[name] = Model.Field.create(name, props, _this);
                });

                data && objects.each(this.fields, function(field, name) {
                    var fieldDecl = _this.fieldsDecl[name];

                    data && !fieldDecl.calculate &&
                    field.initData(typeof data[name] !== 'undefined' ? data[name] : fieldDecl.value);
                });

                this.emit('init');

                return this;
            },

            /**
             * Вычиляет заначения зависимых полей
             * @param {String} name имя поля
             * @param {Object} opts дополнительные парметры доступные в обработчиках событий
             * @returns {Model}
             * @private
             */
            _calcDependsTo: function(name, opts) {
                var fieldsDecl = this.fieldsDecl[name],
                    _this = this;

                fieldsDecl && fieldsDecl.dependsTo && objects.each(fieldsDecl.dependsTo, function(childName) {
                    var fieldDecl = _this.fieldsDecl[childName],
                        field = _this.fields[childName],
                        val;

                    if (field && fieldDecl.calculate && fieldDecl.dependsFrom) {
                        val = fieldDecl.dependsFrom.length > 1 ? fieldDecl.dependsFrom.reduce(function(res, name) {
                            res[name] = _this.fields[name].get();

                            return res;
                        }, {}) : _this.fields[fieldDecl.dependsFrom[0] || fieldDecl.dependsFrom].get();

                        _this.set(childName, fieldDecl.calculate.call(_this, val), opts);
                    }

                });

                return this;
            },

            /**
             * Возвращает значение поля
             * @param {String} name
             * @param {String} [type] формат предтавления значения. по умолчанию вызывается get, либо raw/formatted
             * @returns {*}
             */
            get: function(name, type) {
                if (!type) type = 'get';

                var fieldDecl = this.fieldsDecl[name],
                    method = {
                        raw: 'raw',
                        format: 'format',
                        formatted: 'format',
                        get: 'get'
                    }[type];

                if (this.hasField(name) && method) {
                    if (fieldDecl.calculate && !fieldDecl.dependsFrom)
                        return fieldDecl.calculate.call(this);

                    return this.fields[name][method]();
                }
            },

            /**
             * Задает значение полю модели
             * @param {String} name имя поля
             * @param {*} value значение
             * @param {Object} [opts] дополнительные парметры доступные в обработчиках событий change
             * @returns {Model}
             */
            set: function(name, value, opts) {
                var field = this.fields[name],
                    fieldsScheme = this.fieldsDecl[name];

                opts = objects.extend({}, opts, { value: value });

                if (!field || !fieldsScheme) return this;

                if (!field.isEqual(value)) {
                    field[opts.isInit ? 'initData' : 'set'](value, opts);
                }

                return this;
            },

            /**
             * Очищает поля модели
             * @param {String} [name] имя поля
             * @param {Object} [opts] дополнительные парметры доступные в обработчиках событий change
             * @returns {Model}
             */
            clear: function(name, opts) {
                if (typeof name === 'string') {
                    this.fields[name].clear(opts);
                } else {
                    opts = name;

                    objects.each(this.fields, function(field, fieldName) {
                        if (field.getType() !== 'id' && !this.fieldsDecl[fieldName].calculate)
                            field.clear(opts);
                    }.bind(this));
                }

                this.emit('clear', opts);

                return this;
            },

            /**
             * Задает поля модели по данным из объекта, генерирует событие update на модели
             * @param {Object} data данные устанавливаемые в модели
             * @param {Object} [opts] доп. параметры
             * @returns {Model}
             */
            update: function(data, opts) {
                var _this = this;

                objects.each(data, function(val, name) {
                    _this.set(name, val, opts);
                });

                this.emit('update', opts);

                return this;
            },

            /**
             * Проверяет наличие поля у модели
             * @param {String} name имя поля
             * @returns {boolean}
             */
            hasField: function(name) {
                return !!this.fields[name];
            },

            /**
             * Проверяет поле или всю модель на пустоту
             * @param {String} [name]
             */
            isEmpty: function(name) {
                if (name) {
                    return this.fields[name].isEmpty();
                } else {
                    var isEmpty = true;
                    objects.each(this.fields, function(field) {
                        isEmpty &= field.isEmpty();
                    });

                    return !!isEmpty;
                }
            },

            /**
             * Проверяет, изменилось ли значение поля или любого из полей с момента последней фиксации
             * @param {String} [name] имя поля
             * @returns {Boolean}
             */
            isChanged: function(name) {
                if (name) {
                    return this.fields[name].isChanged();
                } else {
                    var isChanged = false;
                    objects.each(this.fields, function(field) {
                        isChanged |= field.isChanged();
                    });

                    return !!isChanged;
                }
            },

            /**
             * Возвращает тип поля
             * @param {String} name имя поля
             * @returns {String}
             */
            getType: function(name) {
                if (this.hasField(name))
                    return this.fields[name].getType();
            },

            /**
             * Кеширует значения полей модели, генерирует событие fix на модели
             * @param {Object} [opts] доп. параметры
             * @returns {Model}
             */
            fix: function(opts) {
                objects.each(this.fields, function(field) {
                    field.fixData(opts);
                });

                this.emit('fix', opts);

                return this;
            },

            /**
             * Восстанавливает значения полей модели из кеша, генерирует событие update на модели
             * @param {Object} [name] имя поля
             * @param {Object} [opts] доп. параметры
             * @returns {Model}
             */
            rollback: function(name, opts) {
                if (typeof name === 'string') {
                    this.fields[name].rollback(opts);
                } else {
                    opts = name;

                    objects.each(this.fields, function(field) {
                        field.rollback(opts);
                    });
                }

                this.emit('rollback', opts);

                return this;
            },

            /**
             * Возвращает объект с данными модели
             * @returns {Object}
             */
            toJSON: function() {
                var res = {},
                    _this = this;

                objects.each(this.fields, function(field, fieldName) {
                    if (!_this.fieldsDecl[fieldName].internal)
                        res[fieldName] = field.toJSON();
                });

                return res;
            },

            /**
             * Возвращает объект с фиксированными значениями полей
             * @returns {Object}
             */
            getFixedValue: function() {
                var res = {};

                objects.each(this.fields, function(field, fieldName) {
                    res[fieldName] = field.getFixedValue();
                });

                return res;
            },

            /**
             * Назначает обработчик события на модель или поле модели
             * @param {String} [field] имя поля
             * @param {String} e имя события
             * @param {Object} [data] дополнительные данные события
             * @param {Function} fn обработчик события
             * @param {Object} ctx контекст вызова обработчика
             * @returns {Model}
             */
            on: function(field, e, data, fn, ctx) {
                if (functions.isFunction(e)) {
                    ctx = fn;
                    fn = data;
                    data = e;
                    e = field;
                    field = undefined;
                }

                !field ?
                    this.__base(e, data, fn, ctx) :
                    field.split(' ').forEach(function(name) {
                        this.fields[name].on(e, data, fn, ctx);
                    }, this);

                return this;
            },

            /**
             * Удаляет обработчик события с модели или поля модели
             * @param {String} [field] имя поля
             * @param {String} e имя события
             * @param {Function} fn обработчик события
             * @param {Object} ctx контекст вызова обработчика
             * @returns {Model}
             */
            un: function(field, e, fn, ctx) {
                if (functions.isFunction(e)) {
                    ctx = fn;
                    fn = e;
                    e = field;
                    field = undefined;
                }

                !field ?
                    this.__base(e, fn, ctx) :
                    field.split(' ').forEach(function(name) {
                        this.fields[name].un(e, fn, ctx);
                    }, this);

                if (arguments.length === 0) {
                    objects.each(this.fields, function(field) {
                        field.un();
                    });
                }

                return this;
            },

            /**
             * Тригерит обработчик события на модели или поле модели
             * @param {String} [field] имя поля
             * @param {String} e имя события
             * @param {*} [data] данные доступные в обработчике события
             * @returns {Model}
             */
            emit: function(field, e, data) {
                if (!(typeof field == 'string' && typeof e == 'string')) {
                    data = e;
                    e = field;
                    field = undefined;
                }

                !field ?
                    this.__base(e, data) :
                    field.split(' ').forEach(function(name) {
                        this.fields[name].emit(e, data);
                    }, this);

                return this;
            },

            /**
             * Тригерит (с декоратором throttle) событие change на модели при изменении полей
             * @param {String} name имя поля
             * @param {Object} opts доп. параметры
             * @returns {Model}
             * @private
             */
            _onFieldChange: function(name, opts) {
                if (this.changed.indexOf(name) == -1) this.changed.push(name);
                this.fieldsDecl[name].calculate || this._calcDependsTo(name, opts);
                this.emitChange(opts);

                return this;
            },

            /**
             * Сгенерировать событие change на модели
             * @param {Object} opts
             */
            emitChange: function(opts) {
                this.emit('change', objects.extend({}, opts, { changedFields: this.changed }));
                this.changed = [];
            },

            /**
             * Удаляет модель из хранилища
             */
            destruct: function() {
                this.__self.destruct(this);

                this.un();
            },

            /**
             * Возвращает результат проверки модели на валидность
             * @returns {boolean}
             */
            isValid: function() {
                return !!this.validate().valid;
            },

            /**
             * Проверяет модель на валидность, генерирует событие error с описанием ошибки(ок)
             * @param {String} [name] - имя поля
             * @returns {Object}
             */
            validate: function(name) {
                var _this = this,
                    res = {},
                    validateRes;

                if (name) {
                    // событие validated тригерится даже при валидации отдельных полей
                    // нужно дать понять обработчикам, что происходит валидация конкретного
                    // поля, а не всей модели
                    res.field = name;

                    validateRes = this.fields[name].validate();
                    if (validateRes !== true) {
                        res.errorFields = [name];
                        res.errors = validateRes.invalidRules;
                    }
                } else {
                    objects.each(this.fieldsDecl, function(fieldDecl, name) {
                        validateRes = _this.fields[name].validate();
                        if (validateRes !== true) {
                            (res.errorFields || (res.errorFields = [])).push(name);
                            res.errors = (res.errors || []).concat(validateRes.invalidRules);
                            (res.errorsData || (res.errorsData = {}))[name] = validateRes.invalidRules;
                        }
                    });
                }

                if (!res.errors) {
                    res.valid = true;
                } else {
                    this.emit('error', res);
                }

                this.emit('validated', res);

                return res;
            },

            /**
             * Сравнивает значение модели с переданным значением
             * @param {Model|Object} val модель или хеш
             * @returns {boolean}
             */
            isEqual: function(val) {

                if (!val) return false;

                var isComparingValueModel = val instanceof Model,
                    selfFieldNames = Object.keys(this.fields),
                    fieldNamesToCompare = Object.keys(isComparingValueModel ? val.fields : val);

                if (selfFieldNames.length != fieldNamesToCompare.length) return false;

                return !selfFieldNames.some(function(fieldName) {
                    return !this.fields[fieldName].isEqual(isComparingValueModel ? val.get(fieldName) : val[fieldName]);
                }, this);
            }

        }, /** @lends Model */{

            /**
             * Хранилище классов моделей
             */
            models: {},

            /**
             * Харанилище экземпляров моделей
             */
            _modelsStorage: {},

            /**
             * Хранилище деклараций
             */
            decls: {},

            /**
             * Хранилище данных для моделей
             */
            modelsData: {},

            /**
             * Хранилища обработчиков событий на моделях и полях
             */
            modelsTriggers: {},
            fieldsTriggers: {},

            /**
             * Декларирует описание модели
             * поле fields описывается следущим видом:
             * {
             *     field1: 'string',
             *     field2: {
             *         {String} [type] тип поля
             *         {Boolean} [internal] внутреннее поле
             *         {*|Function} [default] дефолтное значение
             *         {*|Function} [value] начанольное значение
             *         {Object|Function} [validation] ф-ия конструктор объекта валидации или он сам
             *         {Function} [format] ф-ия форматирования
             *         {Function} [preprocess] ф-ия вызываемая до записи значения
             *         {Function} [calculate] ф-ия вычисления значения, вызывается, если изменилось одно из связанных
             * полей
             *         {String|Array} [dependsFrom] массив от которых зависит значение поля
             *     }
             * }
             *
             * @static
             * @public
             * @param {String|Object} decl
             * @param {String} decl.model|decl.name
             * @param {String} [decl.baseModel]
             * @param {Object} fields где ключ имя поля, значение строка с типом или объект вида
             * @param {Object} [protoProps] Прототипные методы и поля
             * @param {Object} [staticProps] Статические методы и поля
             */
            decl: function(decl, fields, protoProps, staticProps) {
                if (typeof decl == 'string') {
                    decl = { model: decl };
                } else if (decl.name) {
                    decl.model = decl.name;
                }

                objects.each(fields, function(props, name) {
                    if (typeof props == 'string')
                        fields[name] = { type: props };
                });

                if (decl.baseModel) {
                    if (!Model._modelsStorage[decl.baseModel])
                        throw('baseModel "' + decl.baseModel + '" for "' + decl.model + '" is undefined');

                    fields = objects.extend(true, {}, Model.decls[decl.baseModel], fields);
                }

                Model._modelsStorage[decl.model] = {};
                Model.decls[decl.model] = fields;

                Model.checkModelDecl(decl, fields, protoProps);

                Model.models[decl.model] = inherit(Model.models[decl.baseModel] || Model, protoProps, staticProps);

                Model._buildDeps(fields, decl.model);

                return this;
            },

            /**
             * Проверяет валидность декларации модели
             * @static
             * @protected
             * @param {Object} decl
             * @param {Object} fields
             * @param {Object} protoProps
             */
            checkModelDecl: function(decl, fields, protoProps) {
                protoProps && objects.each(protoProps, function(prop, name) {
                    if (name in Model.prototype && name !== 'toJSON') throw new Error('method "' + name + '" is protected');
                });
            },

            /**
             * Устанавливает связи между зависимыми полями
             * @param {Object} fieldDecl декларация полей
             * @param {String} modelName имя модели
             * @private
             */
            _buildDeps: function(fieldDecl, modelName) {
                var fieldNames = Object.keys(fieldDecl),
                    deps = {};

                function pushDeps(fields, toPushDeps) {
                    fields = Array.isArray(fields) ? fields : [fields];
                    fields.forEach(function(field) {
                        if (!fieldDecl[field])
                            throw Error('in model "' + modelName + '" depended field "' + field + '" is not declared');
                        if (toPushDeps.indexOf(field) !== -1)
                            throw Error('in model "' + modelName + '" circle fields dependence: ' +
                                toPushDeps.concat(field).join(' -> '));

                        var fieldDeps = (deps[field] || (deps[field] = []));

                        fieldDeps.push.apply(fieldDeps, toPushDeps.filter(function(name) {
                            return fieldDeps.indexOf(name) === -1
                        }));

                        fieldDecl[field].dependsFrom &&
                        pushDeps(fieldDecl[field].dependsFrom, toPushDeps.concat(field));
                    });
                }

                fieldNames.forEach(function(fieldName) {
                    var field = fieldDecl[fieldName];

                    if (field.dependsFrom && !Array.isArray(field.dependsFrom))
                        field.dependsFrom = [field.dependsFrom];

                    deps[fieldName] || field.dependsFrom && pushDeps(field.dependsFrom, [fieldName]);
                });

                fieldNames.forEach(function(fieldName) {
                    if (deps[fieldName])
                        fieldDecl[fieldName].dependsTo = deps[fieldName].sort(function(a, b) {
                            var bDeps = deps[b] || [],
                                aDeps = deps[a] || [];

                            if (bDeps.indexOf(a) > -1) {
                                return 1;
                            } else if (aDeps.indexOf(b) > -1) {
                                return -1;
                            } else {
                                return 0;
                            }
                        });
                });

            },

            /**
             * Создает экземпляр модели
             * @public
             * @param {String|Object} modelParams имя модели или параметры модели
             * @param {String} modelParams.name имя модели
             * @param {String|Number} [modelParams.id] идентификатор, если не указан, создается автоматически
             * @param {String} [modelParams.parentName] имя родительской модели
             * @param {String|Number} [modelParams.parentId] идентификатор родительской модели
             * @param {String} [modelParams.parentPath] путь родительской модели
             * @param {Object} [modelParams.parentModel] экземпляр родительской модели
             * @param {Object} [data] данные, которыми будет проинициализирована модель
             * @param {Object} [opts] дополнительные данные передаваемые в событие
             * @returns {Model}
             */
            create: function(modelParams, data, opts) {
                if (typeof modelParams === 'string') modelParams = { name: modelParams };

                var decl = Model.decls[modelParams.name],
                    nameFieldTypeId,
                    modelIdFromData;

                if (!decl) {
                    throw new Error('unknown model: "' + modelParams.name + '"');
                }

                // выставляем id из поля типа 'id' или из декларации
                objects.each(decl, function(field, name) {
                    if (field.type === 'id')
                        nameFieldTypeId = name;
                });

                modelIdFromData = data && nameFieldTypeId && data[nameFieldTypeId];

                // Если id не задан в параметрах - берем id из данных, либо генерируем уникальный
                if (typeof modelParams.id === 'undefined')
                    modelParams.id = modelIdFromData || identify();

                // Если в декларации указано поле с типом `id` и оно не равно id модели - задаем
                if (nameFieldTypeId && modelIdFromData !== modelParams.id) {
                    data = data || {};
                    data[nameFieldTypeId] = modelParams.id;
                }

                var modelConstructor = Model.models[modelParams.name] || Model,
                    model = new modelConstructor(modelParams, data);

                Model._addModel(model);
                model.emit('create', objects.extend({}, opts, { model: model }));

                return model;
            },

            /**
             * Возвращает экземляр или массив экземпляров моделей по имени и пути
             * @protected
             * @param {String|Object} modelParams имя модели или параметры модели
             * @param {String} modelParams.name имя модели
             * @param {String|Number} [modelParams.id] идентификатор, если не указан, создается автоматически
             * @param {String} [modelParams.path] путь модели
             * @param {String} [modelParams.parentName] имя родительской модели
             * @param {String|Number} [modelParams.parentId] идентификатор родительской модели
             * @param {String} [modelParams.parentPath] путь родительской модели
             * @param {Object} [modelParams.parentModel] экземпляр родительской модели
             * @param {Boolean} [dropCache] Не брать значения из кеша
             * @returns {Model[]|Array}
             */
            get: function(modelParams, dropCache) {
                if (typeof modelParams == 'string') modelParams = { name: modelParams };
                modelParams = objects.extend({}, modelParams);

                if (typeof modelParams.id === 'undefined') modelParams.id = ANY_ID;

                var name = modelParams.name,
                    modelsByName = Model._modelsStorage[name],
                    models = [],
                    modelsCacheByName = modelsGroupsCache[name],

                    path = modelParams.path || Model.buildPath(modelParams),
                    paths = path.split(MODELS_SEPARATOR);

                if (!Model.decls[name])
                    throw('model "' + name + '" is not declared');

                if (!dropCache && modelsCacheByName && modelsCacheByName[path]) return modelsCacheByName[path].slice();

                for (var ip = 0, np = paths.length; ip < np; ip++) {
                    var pathRegexp = Model._getPathRegexp(paths[ip]);

                    for (var mPath in modelsByName) {
                        if (modelsByName.hasOwnProperty(mPath) && modelsByName[mPath] !== null && (new RegExp(pathRegexp, 'g')).test(mPath))
                            models.push(modelsByName[mPath]);
                    }
                }

                modelsCacheByName || (modelsGroupsCache[name] = {});
                modelsGroupsCache[name][path] = models.slice();

                return models;
            },

            /**
             * Возвращает экземпляр модели по имени или пути
             * @param {Object|String} modelParams @see get.modelParams
             * @param {Boolean} [dropCache] @see get.dropCache
             * @returns {Model|undefined}
             */
            getOne: function(modelParams, dropCache) {
                return this.get(modelParams, dropCache).pop();
            },

            /**
             * Возвращает созданный или создает экземпляр модели
             * @param {Object|String} modelParams @see get.modelParams
             * @param {Object} [opts] дополнительные данные для события
             * @returns {Model|undefined}
             */
            getOrCreate: function(modelParams, opts) {
                if (typeof modelParams === 'string') modelParams = { name: modelParams };
                var modelData = Model.modelsData[modelParams.name];

                return Model.getOne(modelParams) || Model.create(
                        modelParams,
                        modelData && modelData[Model.buildPath(modelParams)] || {}, opts);
            },

            /**
             * Назначает глобальный обработчик событий на экземпляры моделей по пути
             * @param {String|Object} modelParams Имя модели или параметры описываеющие path модели
             * @param {String} [field] имя поля
             * @param {String} e имя события
             * @param {Function} fn обработчик события
             * @param {Object} [ctx] контекст выполнения обработчика
             * @returns {Model}
             */
            on: function(modelParams, field, e, fn, ctx) {
                if (functions.isFunction(e)) {
                    ctx = fn;
                    fn = e;
                    e = field;
                    field = undefined;
                }

                if (typeof modelParams == 'string') modelParams = { name: modelParams };

                var modelName = modelParams.name,
                    eventPath = Model.buildPath(modelParams),
                    triggers = !field ?
                    Model.modelsTriggers[modelName] || (Model.modelsTriggers[modelName] = {}) :
                    (Model.fieldsTriggers[modelName] || (Model.fieldsTriggers[modelName] = {})) &&
                    Model.fieldsTriggers[modelName][field] || (Model.fieldsTriggers[modelName][field] = {});

                e.split(' ').forEach(function(event) {
                    (triggers[event] || (triggers[event] = [])).push({
                        name: modelName,
                        path: eventPath,
                        field: field,
                        fn: fn,
                        ctx: ctx
                    });
                });

                Model.forEachModel(function() {
                    this.on(field, e, fn, ctx);
                }, modelParams, true);

                return this;
            },

            /**
             * Удаляет глобальный обработчик событий на экземпляры моделей по пути
             * @param {String|Object} modelParams Имя модели или параметры описываеющие path модели
             * @param {String} [field] имя поля
             * @param {String} e имя события
             * @param {Function} fn обработчик события
             * @param {Object} [ctx] контекст выполнения обработчика
             * @returns {Model}
             */
            un: function(modelParams, field, e, fn, ctx) {
                if (functions.isFunction(e)) {
                    ctx = fn;
                    fn = e;
                    e = field;
                    field = undefined;
                }

                if (typeof modelParams == 'string') modelParams = { name: modelParams };

                var modelName = modelParams.name,
                    eventPath = Model.buildPath(modelParams),
                    triggers = !field ?
                        Model.modelsTriggers[modelName] :
                    Model.fieldsTriggers[modelName] && Model.fieldsTriggers[modelName][field];

                e.split(' ').forEach(function(event) {
                    var pos;

                    triggers[event] && objects.each(triggers[event], function(event, i) {
                        if (event.path === eventPath &&
                            event.fn === fn &&
                            event.ctx === ctx &&
                            event.field === field) {

                            pos = i;

                            return false;
                        }
                    });

                    if (typeof pos !== 'undefined') {

                        // удаляем обработчик из хранилища
                        triggers[event].splice(pos, 1);

                        // отписываем обработчик с моделей
                        Model.forEachModel(function() {
                            this.un(event.field, event, fn, ctx);
                        }, modelParams, true);

                    }
                });

                return this;
            },

            /**
             * Тригерит событие на моделях по имени и пути
             * @param {String|Object} modelParams Имя модели или параметры описываеющие path модели
             * @param {String} [field] имя поля
             * @param {String} e имя события
             * @param {Object} [data] данные передаваемые в обработчик события
             * @returns {Model}
             */
            emit: function(modelParams, field, e, data) {
                if (!(typeof field == 'string' && typeof e == 'string')) {
                    data = e;
                    e = field;
                    field = undefined;
                }

                if (typeof modelParams == 'string') modelParams = { name: modelParams };

                e.split(' ').forEach(function(event) {
                    Model.forEachModel(function() {
                        this.emit(field, event, data);
                    }, modelParams, true);
                });

                return this;
            },

            /**
             * Назначает глобальные обработчики событий на экземпляр модели
             * @param {Model} model экземпляр модели
             * @returns {Model}
             * @private
             */
            _bindToModel: function(model) {
                return this._bindToEvents(model, Model.modelsTriggers[model.name]);
            },

            /**
             * Назначает глобальные обработчики событий на поля экземпляра модели
             * @param {Model} model экземпляр модели
             * @returns {Model}
             * @private
             */
            _bindToFields: function(model) {
                var _this = this,
                    fields = this.fieldsTriggers[model.name];

                fields && objects.each(fields, function(fieldTriggers) {

                    _this._bindToEvents(model, fieldTriggers);

                });

                return this;
            },

            /**
             * Хелпер навешивания событий на экземпляр модели
             * @param {Model} model экземпляр модели
             * @param {Object} events события
             * @returns {Model}
             * @private
             */
            _bindToEvents: function(model, events) {
                var _this = this;

                events && objects.each(events, function(storage, eventName) {
                    storage.forEach(function(event) {
                        var regExp = new RegExp(this._getPathRegexp(event.path), 'g');

                        if (regExp.test(model.path())) {
                            model.on(event.field, eventName, event.fn, event.ctx);
                        }
                    }, _this);
                });

                return this;
            },

            /**
             * Добавляет модель в хранилище
             * @private
             * @param {Model} model экземпляр модели
             * @returns {Model}
             * @private
             */
            _addModel: function(model) {

                Model._modelsStorage[model.name][model.path()] = model;
                modelsGroupsCache[model.name] = null;

                Model
                    ._bindToModel(model)
                    ._bindToFields(model);

                return this;
            },

            /**
             * Уничтожает экземпляр модели, удаляет его из хранилища
             * @param {Model|String|Object} modelParams Модель, имя модели или параметры описываеющие path модели
             * @returns {Model}
             */
            destruct: function(modelParams) {
                if (typeof modelParams == 'string') modelParams = { name: modelParams };

                if (modelParams instanceof Model)
                    modelParams = {
                        path: modelParams.path(),
                        name: modelParams.name,
                        id: modelParams.id
                    };

                Model.forEachModel(function() {

                    objects.each(this.fields, function(field) {
                        field.destruct();
                    });

                    Model._modelsStorage[this.name][this.path()] = null;
                    this.emit('destruct', { model: this });
                }, modelParams, true);

                modelsGroupsCache[modelParams.name] = null;

                return this;
            },

            /**
             * Возвращает путь к модели по заданным параметрам
             * @param {Object|Array} pathParts параметры пути
             * @param {String} pathParts.name имя модели
             * @param {String|Number} [pathParts.id] идентификатор модели
             *
             * @param {String} [pathParts.parentName] имя родитеской модели
             * @param {String|Number} [pathParts.parentId] идентификатор родительской модели
             * @param {String|Object} [pathParts.parentPath] путь родительской модели
             * @param {Model} [pathParts.parentModel] экземпляр родительской модели
             *
             * @param {String} [pathParts.childName] имя дочерней модели
             * @param {String|Number} [pathParts.childId] идентификатор дочерней модели
             * @param {String|Object} [pathParts.childPath] путь дочерней модели
             * @param {Model} [pathParts.childModel] экземпляр дочерней модели
             * @returns {String}
             */
            buildPath: function(pathParts) {
                if (Array.isArray(pathParts))
                    return pathParts.map(Model.buildPath).join(MODELS_SEPARATOR);

                var parts = { parent: '', child: '' };

                ['parent', 'child'].forEach(function buildPathForEach(el) {
                    var path = pathParts[el + 'Path'],
                        model = pathParts[el + 'Model'],
                        name = pathParts[el + 'Name'],
                        id = pathParts[el + 'Id'];

                    parts[el] = model && model.path() ||
                        (typeof path === 'object' ? Model.buildPath(path) : path) ||
                        (name ? name + (typeof id !== 'undefined' ? ID_SEPARATOR + id : '') : '');
                });

                return (parts.parent ? parts.parent + CHILD_SEPARATOR : '') +
                    pathParts.name +
                    ID_SEPARATOR + (typeof pathParts.id !== 'undefined' ? pathParts.id : ANY_ID) +
                    (parts.child ? CHILD_SEPARATOR + parts.child : '');
            },

            /**
             * Возвращает строку для построения регулярного выражения проверки пути
             * @param {String} path
             * @returns {String}
             * @private
             */
            _getPathRegexp: function(path) {
                return path.replace(new RegExp('\\' + ANY_ID, 'g'), '([^' + CHILD_SEPARATOR + ID_SEPARATOR + ']*)') + '$';
            },

            /**
             * Выполняет callback для каждой модели найденной по заданному пути. Если callback вернул false, то
             * итерация остановливается
             * @param {Function} callback ф-ия выполняемая для каждой модели
             * @param {String|Object} modelParams параметры модели
             * @param {Boolean} [dropCache] Не брать значения из кеша
             * @returns {Model}
             */
            forEachModel: function(callback, modelParams, dropCache) {
                var modelsByPath = Model.get(modelParams, dropCache);

                if (Array.isArray(modelsByPath))
                    for (var i = 0, n = modelsByPath.length; i < n; i++)
                        if (callback.call(modelsByPath[i]) === false) break;

                return this;
            }
        });

        provide(Model)
    });
